//! Google Calendar API sync ([OPP-053](https://github.com/cirne/zmail)).

use std::collections::HashMap;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use chrono::{Days, Duration, NaiveDate, TimeZone, Utc};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;

use crate::oauth::ensure_google_access_token;
use crate::sync::sync_log::SyncFileLogger;

use super::db;
use super::model::CalendarEventRow;

type SyncResult = Result<
    (
        u32,
        Vec<String>,
        HashMap<String, String>,
        HashMap<String, String>,
    ),
    Box<dyn std::error::Error>,
>;

type GoogleCalendarNamesAndColors = (HashMap<String, String>, HashMap<String, String>);

const GCAL_EVENTS: &str = "https://www.googleapis.com/calendar/v3/calendars";
const GCAL_LIST: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn parse_google_event(
    cal_id: &str,
    source_id: &str,
    v: &Value,
    calendar_color: Option<&str>,
) -> Option<CalendarEventRow> {
    let id = v.get("id")?.as_str()?;
    let uid = id.to_string();
    let status = v.get("status").and_then(|s| s.as_str()).map(String::from);
    if status.as_deref() == Some("cancelled") {
        return None;
    }
    let summary = v.get("summary").and_then(|s| s.as_str()).map(String::from);
    let description = v
        .get("description")
        .and_then(|s| s.as_str())
        .map(String::from);
    let location = v.get("location").and_then(|s| s.as_str()).map(String::from);
    let color = v
        .get("backgroundColor")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| calendar_color.filter(|s| !s.is_empty()).map(String::from));
    let (all_day, start_at, end_at, tz) = parse_google_time(v)?;
    let updated_at = v
        .get("updated")
        .and_then(|s| s.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp());

    Some(CalendarEventRow {
        source_id: source_id.to_string(),
        source_kind: "googleCalendar".to_string(),
        calendar_id: cal_id.to_string(),
        calendar_name: None,
        uid,
        summary,
        description,
        location,
        start_at,
        end_at,
        all_day,
        timezone: tz,
        status,
        rrule: None,
        recurrence_json: v.get("recurrence").cloned().map(|x| x.to_string()),
        attendees_json: v.get("attendees").cloned().map(|x| x.to_string()),
        organizer_email: v
            .get("organizer")
            .and_then(|o| o.get("email"))
            .and_then(|e| e.as_str())
            .map(String::from),
        organizer_name: v
            .get("organizer")
            .and_then(|o| o.get("displayName"))
            .and_then(|e| e.as_str())
            .map(String::from),
        updated_at,
        synced_at: Some(unix_now()),
        color,
        raw_json: Some(v.to_string()),
    })
}

fn parse_google_time(v: &Value) -> Option<(bool, i64, i64, Option<String>)> {
    let start = v.get("start")?;
    let end = v.get("end")?;
    if let Some(ds) = start.get("date").and_then(|d| d.as_str()) {
        let de = end.get("date")?.as_str()?;
        let sd = chrono::NaiveDate::parse_from_str(ds, "%Y-%m-%d").ok()?;
        let ed = chrono::NaiveDate::parse_from_str(de, "%Y-%m-%d").ok()?;
        let s = sd.and_hms_opt(0, 0, 0)?;
        let e_dt = ed.and_hms_opt(0, 0, 0)?;
        let ss = Utc.from_utc_datetime(&s).timestamp();
        let ee = Utc.from_utc_datetime(&e_dt).timestamp();
        return Some((true, ss, ee, None));
    }
    let sdt = start.get("dateTime")?.as_str()?;
    let edt = end.get("dateTime")?.as_str()?;
    let st = chrono::DateTime::parse_from_rfc3339(sdt)
        .ok()?
        .with_timezone(&Utc);
    let et = chrono::DateTime::parse_from_rfc3339(edt)
        .ok()?
        .with_timezone(&Utc);
    let tz = start
        .get("timeZone")
        .and_then(|t| t.as_str())
        .map(String::from);
    Some((false, st.timestamp(), et.timestamp(), tz))
}

fn sanitize_calendar_url_for_log(url: &str) -> String {
    let Some(pos) = url.find("syncToken=") else {
        return url.to_string();
    };
    let after_eq = pos + "syncToken=".len();
    let tail = &url[after_eq..];
    let token_len = tail.find('&').unwrap_or(tail.len());
    let mut out = String::with_capacity(url.len());
    out.push_str(&url[..after_eq]);
    out.push_str("REDACTED");
    out.push_str(&url[after_eq + token_len..]);
    out
}

fn err_is_gcal_410(e: &dyn std::error::Error) -> bool {
    e.to_string().contains("gcal_410")
}

fn gcal_full_list_url(
    cal_id: &str,
    time_min: &str,
    time_max: &str,
    page_token: Option<&str>,
) -> String {
    let cid_enc = urlencoding::encode(cal_id);
    // Do not use `orderBy`: Google's API omits `nextSyncToken` when `orderBy` is set, so we would
    // never persist a sync checkpoint for incremental refresh (see Calendar events.list docs).
    let mut url = format!(
        "{GCAL_EVENTS}/{cid_enc}/events?singleEvents=true&maxResults=250&timeMin={}&timeMax={}",
        urlencoding::encode(time_min),
        urlencoding::encode(time_max),
    );
    if let Some(p) = page_token {
        url.push_str("&pageToken=");
        url.push_str(&urlencoding::encode(p));
    }
    url
}

fn gcal_incremental_list_url(cal_id: &str, sync_token: &str, page_token: Option<&str>) -> String {
    let cid_enc = urlencoding::encode(cal_id);
    let mut url = format!(
        "{GCAL_EVENTS}/{cid_enc}/events?singleEvents=true&maxResults=250&showDeleted=true&syncToken={}",
        urlencoding::encode(sync_token),
    );
    if let Some(p) = page_token {
        url.push_str("&pageToken=");
        url.push_str(&urlencoding::encode(p));
    }
    url
}

fn apply_google_list_items(
    tx: &rusqlite::Transaction<'_>,
    items: &[Value],
    cal_id: &str,
    source_id: &str,
    calendar_color: Option<&str>,
    calendar_names: &HashMap<String, String>,
    apply_cancellations: bool,
) -> rusqlite::Result<u32> {
    let mut n = 0u32;
    for item in items {
        if item.get("status").and_then(|s| s.as_str()) == Some("cancelled") {
            if apply_cancellations {
                if let Some(uid) = item.get("id").and_then(|s| s.as_str()) {
                    db::delete_event_by_uid(tx, source_id, uid)?;
                    n += 1;
                }
            }
            continue;
        }
        if let Some(mut row) = parse_google_event(cal_id, source_id, item, calendar_color) {
            if let Some(name) = calendar_names.get(cal_id) {
                row.calendar_name = Some(name.clone());
            }
            db::upsert_event(tx, &row)?;
            n += 1;
        }
    }
    Ok(n)
}

#[allow(clippy::too_many_arguments)]
fn sync_google_calendar_full(
    tx: &rusqlite::Transaction<'_>,
    auth: &str,
    source_id: &str,
    cal_id: &str,
    calendar_color: Option<&str>,
    calendar_names: &HashMap<String, String>,
    time_min: &str,
    time_max: &str,
) -> Result<(u32, u32), Box<dyn std::error::Error>> {
    let mut page_token: Option<String> = None;
    let mut count: u32 = 0;
    let mut pages: u32 = 0;

    loop {
        pages += 1;
        let url = gcal_full_list_url(cal_id, time_min, time_max, page_token.as_deref());
        let val = fetch_json(auth, &url)?;
        if let Some(items) = val.get("items").and_then(|i| i.as_array()) {
            count += apply_google_list_items(
                tx,
                items,
                cal_id,
                source_id,
                calendar_color,
                calendar_names,
                false,
            )?;
        }
        let next_sync = val
            .get("nextSyncToken")
            .and_then(|s| s.as_str())
            .map(String::from);
        page_token = val
            .get("nextPageToken")
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);

        if page_token.is_none() {
            if let Some(ref ns) = next_sync {
                db::set_sync_token(tx, source_id, cal_id, Some(ns.as_str()))?;
            }
            break;
        }
    }
    Ok((count, pages))
}

fn sync_google_calendar_incremental(
    tx: &rusqlite::Transaction<'_>,
    auth: &str,
    source_id: &str,
    cal_id: &str,
    calendar_color: Option<&str>,
    calendar_names: &HashMap<String, String>,
    sync_token: &str,
) -> Result<(u32, u32), Box<dyn std::error::Error>> {
    let mut page_token: Option<String> = None;
    let mut count: u32 = 0;
    let mut pages: u32 = 0;

    loop {
        pages += 1;
        let url = gcal_incremental_list_url(cal_id, sync_token, page_token.as_deref());
        let val = fetch_json(auth, &url)?;
        if let Some(items) = val.get("items").and_then(|i| i.as_array()) {
            count += apply_google_list_items(
                tx,
                items,
                cal_id,
                source_id,
                calendar_color,
                calendar_names,
                true,
            )?;
        }
        let next_sync = val
            .get("nextSyncToken")
            .and_then(|s| s.as_str())
            .map(String::from);
        page_token = val
            .get("nextPageToken")
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);

        if page_token.is_none() {
            if let Some(ref ns) = next_sync {
                db::set_sync_token(tx, source_id, cal_id, Some(ns.as_str()))?;
            }
            break;
        }
    }
    Ok((count, pages))
}

fn fetch_json(auth: &str, url: &str) -> Result<Value, Box<dyn std::error::Error>> {
    eprintln!(
        "ripmail: fetching calendar JSON from {}",
        sanitize_calendar_url_for_log(url)
    );
    let resp = match ureq::get(url)
        .set("Authorization", &format!("Bearer {auth}"))
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(410, _)) => {
            return Err("gcal_410_sync_token".into());
        }
        Err(e) => return Err(e.into()),
    };
    let status = resp.status();
    let body = resp.into_string().unwrap_or_default();
    if !(200..300).contains(&status) {
        eprintln!("ripmail: Google Calendar API error {}: {}", status, body);
        return Err(format!("Google Calendar API HTTP {status}: {body}").into());
    }
    Ok(serde_json::from_str(&body)?)
}

/// Parses Google Calendar [`calendarList`](https://developers.google.com/calendar/api/v3/reference/calendarList/list) response `items`.
fn ingest_google_calendar_list(
    val: &Value,
) -> (
    Vec<String>,
    HashMap<String, String>,
    HashMap<String, String>,
) {
    let mut discovered_ids = Vec::new();
    let mut calendar_names = HashMap::new();
    let mut calendar_colors = HashMap::new();
    if let Some(items) = val.get("items").and_then(|i| i.as_array()) {
        for item in items {
            if let Some(id) = item.get("id").and_then(|id| id.as_str()) {
                discovered_ids.push(id.to_string());
                if let Some(name) = item.get("summary").and_then(|s| s.as_str()) {
                    calendar_names.insert(id.to_string(), name.to_string());
                }
                if let Some(bg) = item.get("backgroundColor").and_then(|s| s.as_str()) {
                    if !bg.is_empty() {
                        calendar_colors.insert(id.to_string(), bg.to_string());
                    }
                }
            }
        }
    }
    (discovered_ids, calendar_names, calendar_colors)
}

/// Fetch all calendars accessible to the Google account directly from the Calendar API.
/// Returns `(calendar_id → display_name, calendar_id → backgroundColor hex)`. Does not write to disk or modify any index.
pub fn fetch_google_calendar_names_api(
    home: &Path,
    token_mailbox_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<GoogleCalendarNamesAndColors, Box<dyn std::error::Error>> {
    let token =
        ensure_google_access_token(home, token_mailbox_id, env_file, process_env).map_err(|e| {
            format!(
                "Google Calendar OAuth: {e}. Ensure `google-oauth.json` exists under \
                 RIPMAIL_HOME/{token_mailbox_id}/."
            )
        })?;
    if let Ok(val) = fetch_json(&token, GCAL_LIST) {
        let (_, names, colors) = ingest_google_calendar_list(&val);
        return Ok((names, colors));
    }
    Ok((HashMap::new(), HashMap::new()))
}

#[allow(clippy::too_many_arguments)]
pub fn sync_google_calendars(
    conn: &mut rusqlite::Connection,
    home: &Path,
    source_id: &str,
    calendar_ids: &[String],
    token_mailbox_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
    force_full: bool,
    logger: &SyncFileLogger,
) -> SyncResult {
    let token = ensure_google_access_token(home, token_mailbox_id, env_file, process_env).map_err(
        |e| {
            format!(
                "Google Calendar OAuth: {e}. Ensure `google-oauth.json` exists under \
                 RIPMAIL_HOME/{token_mailbox_id}/ (re-run `ripmail setup --google-oauth` or set oauth_source_id)."
            )
        },
    )?;

    // Calendar list: names + colors for agents + **all** list entries are indexed (same idea as Apple:
    // everything is synced; `default_calendars` in config limits default CLI queries).
    let (discovered_ids, calendar_names, calendar_colors) = match fetch_json(&token, GCAL_LIST) {
        Ok(val) => ingest_google_calendar_list(&val),
        Err(_) => (Vec::new(), HashMap::new(), HashMap::new()),
    };

    let sync_calendar_ids = if !discovered_ids.is_empty() {
        discovered_ids.clone()
    } else {
        let mut fallback = calendar_ids.to_vec();
        if fallback.is_empty() {
            fallback.push("primary".into());
        }
        fallback
    };

    let tx = conn.transaction()?;
    if force_full {
        db::clear_sync_tokens_for_source(&tx, source_id)?;
    }

    let mut count: u32 = 0;
    let time_min = (Utc::now() - Duration::days(365 * 2)).to_rfc3339();
    let time_max = (Utc::now() + Duration::days(365 * 3)).to_rfc3339();

    for cal_id in &sync_calendar_ids {
        let cal_started = Instant::now();
        let calendar_color = calendar_colors.get(cal_id).map(|s| s.as_str());

        let token_row = db::get_sync_token(&tx, source_id, cal_id)?;
        let try_incremental =
            !force_full && token_row.as_ref().map(|s| !s.is_empty()).unwrap_or(false);

        let sync_outcome = if try_incremental {
            let st = token_row.as_deref().expect("try_incremental implies token");
            match sync_google_calendar_incremental(
                &tx,
                &token,
                source_id,
                cal_id,
                calendar_color,
                &calendar_names,
                st,
            ) {
                Ok(r) => Ok(("gcal_incremental", r.0, r.1)),
                Err(e) if err_is_gcal_410(&*e) => {
                    db::clear_sync_token(&tx, source_id, cal_id)?;
                    db::delete_events_for_source_calendar(&tx, source_id, cal_id)?;
                    logger.info(
                        &format!(
                            "Google Calendar gcal_410_retry_full (source_id={} calendar_id={})",
                            source_id, cal_id
                        ),
                        None,
                    );
                    sync_google_calendar_full(
                        &tx,
                        &token,
                        source_id,
                        cal_id,
                        calendar_color,
                        &calendar_names,
                        &time_min,
                        &time_max,
                    )
                    .map(|r| ("gcal_full", r.0, r.1))
                }
                Err(e) => Err(e),
            }
        } else {
            db::delete_events_for_source_calendar(&tx, source_id, cal_id)?;
            sync_google_calendar_full(
                &tx,
                &token,
                source_id,
                cal_id,
                calendar_color,
                &calendar_names,
                &time_min,
                &time_max,
            )
            .map(|r| ("gcal_full", r.0, r.1))
        };

        let (mode_label, n, pages) = match sync_outcome {
            Ok(x) => x,
            Err(e) => {
                eprintln!("ripmail: skipping calendar {cal_id} due to error: {e}");
                continue;
            }
        };

        count += n;
        let duration_ms = cal_started.elapsed().as_millis() as u64;
        logger.info(
            &format!(
                "Google Calendar {mode_label} (source_id={source_id} calendar_id={cal_id} pages={pages} mutations={n} duration_ms={duration_ms})"
            ),
            None,
        );
    }

    tx.commit()?;
    Ok((count, discovered_ids, calendar_names, calendar_colors))
}

#[cfg(test)]
mod parse_google_event_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_google_event_uses_calendar_color_when_event_has_none() {
        let v = json!({
            "id": "evt1",
            "start": { "dateTime": "2025-06-01T10:00:00Z", "timeZone": "UTC" },
            "end": { "dateTime": "2025-06-01T11:00:00Z", "timeZone": "UTC" }
        });
        let row = parse_google_event("cal_a", "src1", &v, Some("#aabbcc")).expect("row");
        assert_eq!(row.color.as_deref(), Some("#aabbcc"));
        assert_eq!(row.calendar_id, "cal_a");
    }

    #[test]
    fn parse_google_event_prefers_event_background_over_calendar_default() {
        let v = json!({
            "id": "evt2",
            "backgroundColor": "#111111",
            "start": { "dateTime": "2025-06-02T15:00:00Z", "timeZone": "UTC" },
            "end": { "dateTime": "2025-06-02T16:00:00Z", "timeZone": "UTC" }
        });
        let row = parse_google_event("cal_a", "src1", &v, Some("#aabbcc")).expect("row");
        assert_eq!(row.color.as_deref(), Some("#111111"));
    }

    #[test]
    fn parse_google_event_skips_empty_calendar_color_string() {
        let v = json!({
            "id": "evt3",
            "start": { "dateTime": "2025-06-03T08:00:00Z", "timeZone": "UTC" },
            "end": { "dateTime": "2025-06-03T09:00:00Z", "timeZone": "UTC" }
        });
        let row = parse_google_event("cal_a", "src1", &v, Some("")).expect("row");
        assert!(row.color.is_none());
    }

    #[test]
    fn ingest_google_calendar_list_reads_background_colors() {
        let val = json!({
            "items": [
                {"id": "cal1", "summary": "One", "backgroundColor": "#111111"},
                {"id": "cal2", "summary": "Two"}
            ]
        });
        let (ids, names, colors) = ingest_google_calendar_list(&val);
        assert_eq!(ids.len(), 2);
        assert_eq!(names.get("cal1").map(|s| s.as_str()), Some("One"));
        assert_eq!(colors.get("cal1").map(|s| s.as_str()), Some("#111111"));
        assert!(!colors.contains_key("cal2"));
    }

    #[test]
    fn gcal_incremental_url_shape() {
        let u = gcal_incremental_list_url("primary", "tok=value", None);
        assert!(u.contains("showDeleted=true"));
        assert!(!u.contains("orderBy="));
        assert!(!u.contains("timeMin="));
        assert!(u.contains("syncToken="));
    }

    #[test]
    fn gcal_full_url_shape() {
        let u = gcal_full_list_url(
            "primary",
            "2020-01-01T00:00:00Z",
            "2030-01-01T00:00:00Z",
            None,
        );
        assert!(
            !u.contains("orderBy="),
            "orderBy prevents nextSyncToken from Google on full list"
        );
        assert!(u.contains("timeMin="));
        assert!(u.contains("timeMax="));
        assert!(!u.contains("syncToken="));
    }

    #[test]
    fn sanitize_calendar_url_for_log_redacts_sync_token() {
        let u = "https://example.com/x?syncToken=SECRET&foo=1";
        let s = sanitize_calendar_url_for_log(u);
        assert!(s.contains("REDACTED"));
        assert!(!s.contains("SECRET"));
    }

    #[test]
    fn apply_google_list_items_deletes_cancelled_when_incremental() {
        use std::collections::HashMap;

        use crate::calendar::db as cal_db;
        use crate::calendar::model::CalendarEventRow;
        use crate::db::apply_schema;

        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mut row = CalendarEventRow::default();
        row.source_id = "src1".into();
        row.source_kind = "googleCalendar".into();
        row.calendar_id = "cal_a".into();
        row.uid = "evt_del".into();
        row.summary = Some("gone".into());
        row.start_at = 100;
        row.end_at = 200;
        cal_db::upsert_event(&conn, &row).unwrap();
        assert_eq!(cal_db::count_events_for_source(&conn, "src1").unwrap(), 1);

        let tx = conn.transaction().unwrap();
        let items = vec![json!({"id": "evt_del", "status": "cancelled"})];
        let n = apply_google_list_items(&tx, &items, "cal_a", "src1", None, &HashMap::new(), true)
            .unwrap();
        assert_eq!(n, 1);
        tx.commit().unwrap();
        assert_eq!(cal_db::count_events_for_source(&conn, "src1").unwrap(), 0);
    }
}

/// Preset vs raw RRULE for [build_recurrence_json_array].
pub struct RecurrenceArgs<'a> {
    pub preset: Option<&'a str>,
    pub rrule: Option<&'a str>,
    pub count: Option<u32>,
    pub until: Option<&'a str>,
}

/// Build `recurrence` array for Google Calendar (single `RRULE:` line).
pub fn build_recurrence_json_array(recur: &RecurrenceArgs<'_>) -> Result<Vec<String>, String> {
    let preset = recur
        .preset
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let raw = recur
        .rrule
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    match (preset, raw) {
        (Some(_), Some(_)) => {
            Err("provide either recurrence preset or raw --rrule, not both".into())
        }
        (_, Some(line)) => {
            let rr = normalize_rrule_line(line)?;
            Ok(vec![finalize_rrule_with_count_until(
                &rr,
                recur.count,
                recur.until,
            )?])
        }
        (Some(p), _) => {
            let base_rrule = match p.to_ascii_lowercase().as_str() {
                "daily" => "RRULE:FREQ=DAILY",
                "weekdays" => "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
                "weekly" => "RRULE:FREQ=WEEKLY",
                "biweekly" => "RRULE:FREQ=WEEKLY;INTERVAL=2",
                "monthly" => "RRULE:FREQ=MONTHLY",
                "yearly" => "RRULE:FREQ=YEARLY",
                _ => return Err(format!("unknown recurrence preset {p:?} (try daily|weekdays|weekly|biweekly|monthly|yearly)")),
            };
            Ok(vec![finalize_rrule_with_count_until(
                base_rrule,
                recur.count,
                recur.until,
            )?])
        }
        (None, None) => {
            let line = finalize_rrule_with_count_until("", recur.count, recur.until)?;
            if line.is_empty() {
                return Err(
                    "recurrence requires recurrence_preset, --rrule, recurrence_count, or recurrence_until".into(),
                );
            }
            Ok(vec![line])
        }
    }
}

fn normalize_rrule_line(line: &str) -> Result<String, String> {
    let t = line.trim();
    let u = if t.to_ascii_uppercase().starts_with("RRULE:") {
        format!("RRULE:{}", &t[6..].trim_start_matches(':'))
    } else {
        format!("RRULE:{t}")
    };
    Ok(u.trim().to_string())
}

fn naive_ymd_to_until_z(naive: NaiveDate) -> String {
    format!("{}T235959Z", naive.format("%Y%m%d"))
}

/// Append COUNT / UNTIL to an RRULE line (or finalize empty stub when only COUNT/UNTIL given).
pub fn finalize_rrule_with_count_until(
    base_rrule: &str,
    count: Option<u32>,
    until_ymd: Option<&str>,
) -> Result<String, String> {
    let mut s = base_rrule.trim().to_string();
    if !(s.is_empty() || s.starts_with("RRULE:")) {
        s = normalize_rrule_line(&s)?;
    }

    let until_part = match until_ymd {
        Some(d) => {
            let naive = NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d")
                .map_err(|e| format!("invalid recurrence_until: {e}"))?;
            naive_ymd_to_until_z(naive)
        }
        None => String::new(),
    };

    if s.is_empty() {
        match (count, until_ymd) {
            (Some(c), None) => Ok(format!(
                "{}{}",
                "RRULE:FREQ=DAILY",
                format_counts_until(Some(c), &until_part)
            )),
            (_, Some(_)) => {
                if until_part.is_empty() {
                    return Err("until parse failed".into());
                }
                Ok(format!(
                    "{}{}",
                    "RRULE:FREQ=DAILY",
                    format_counts_until(count, &until_part)
                ))
            }
            _ => Err("cannot build recurrence: empty RRULE".into()),
        }
    } else {
        let mut stripped = strip_rrule_count_until(&s);
        if count.is_some() || until_ymd.is_some() {
            stripped.push_str(&format_counts_until(count, &until_part));
        }
        Ok(stripped)
    }
}

fn format_counts_until(count: Option<u32>, until_z: &str) -> String {
    let mut o = String::new();
    if let Some(c) = count {
        o.push_str(&format!(";COUNT={c}"));
    }
    if !until_z.is_empty() {
        o.push_str(&format!(";UNTIL={until_z}"));
    }
    o
}

fn strip_rrule_count_until(rrule_full: &str) -> String {
    strip_until_count_via_split(rrule_full)
}

fn strip_until_count_via_split(rrule_full: &str) -> String {
    let up = rrule_full.trim();
    let rest = up
        .strip_prefix("RRULE:")
        .or_else(|| up.strip_prefix("rrule:"))
        .unwrap_or(up);
    let parts: Vec<_> = rest
        .split(';')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .filter(|p| {
            let lu = (*p).to_ascii_lowercase();
            !lu.starts_with("count=") && !lu.starts_with("until=")
        })
        .collect();
    format!("RRULE:{}", parts.join(";"))
}

/// Strip Google Calendar recurring **instance** id suffix `_YYYYMMDDTHHmmssZ`.
pub fn infer_google_recurring_master_event_id(event_id: &str) -> &str {
    static RE: OnceLock<Regex> = OnceLock::new();
    let trimmed = event_id.trim();
    if let Some(caps) = RE
        .get_or_init(|| Regex::new(r"^(.*)_\d{8}T\d{6}Z$").expect("infer master regex"))
        .captures(trimmed)
    {
        caps.get(1).map(|m| m.as_str()).unwrap_or(trimmed)
    } else {
        trimmed
    }
}

/// Fields for [insert_google_calendar_event] — Google Calendar API `events.insert`.
pub struct InsertGoogleEventArgs<'a> {
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub location: Option<&'a str>,
    /// When `true`, [Self::all_day_date] is required (YYYY-MM-DD, local calendar day). End is exclusive (next day).
    pub all_day: bool,
    pub all_day_date: Option<&'a str>,
    /// For timed events: RFC3339 / `dateTime` strings (e.g. `2026-04-23T15:00:00-04:00`). Required when `all_day` is false.
    pub start_rfc3339: Option<&'a str>,
    pub end_rfc3339: Option<&'a str>,
    pub recurrence: Option<RecurrenceArgs<'a>>,
}

/// Build PATCH body for selective Google Calendar updates.
#[allow(clippy::too_many_arguments)]
pub fn build_google_calendar_event_patch_body(
    title: Option<&str>,
    description: Option<&str>,
    location: Option<&str>,
    start_rfc3339: Option<&str>,
    end_rfc3339: Option<&str>,
    all_day: bool,
    all_day_date: Option<&str>,
    recurrence_patch: Option<RecurrenceArgs<'_>>,
    clear_recurrence: bool,
) -> Result<Value, String> {
    let mut v = json!({});
    if clear_recurrence {
        v["recurrence"] = json!(serde_json::Value::Null);
    }
    if let Some(rec) = recurrence_patch {
        let arr = build_recurrence_json_array(&rec)?;
        v["recurrence"] = serde_json::to_value(arr).unwrap();
    }
    if let Some(t) = title.filter(|x| !x.trim().is_empty()) {
        v["summary"] = json!(t);
    }
    if let Some(d) = description.filter(|x| !x.trim().is_empty()) {
        v["description"] = json!(d);
    } else if let Some(d) = description {
        if d.is_empty() {
            v["description"] = json!(serde_json::Value::Null);
        }
    }
    if let Some(l) = location.filter(|x| !x.trim().is_empty()) {
        v["location"] = json!(l);
    } else if let Some(l) = location {
        if l.is_empty() {
            v["location"] = json!(serde_json::Value::Null);
        }
    }
    if all_day {
        let d = all_day_date.ok_or("all_day_date is required when all_day is true for patch")?;
        let start = NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d")
            .map_err(|e| format!("invalid all_day_date: {e}"))?;
        let end = start
            .checked_add_days(Days::new(1))
            .ok_or("date overflow")?;
        v["start"] = json!({ "date": start.format("%Y-%m-%d").to_string() });
        v["end"] = json!({ "date": end.format("%Y-%m-%d").to_string() });
    } else if start_rfc3339.is_some() || end_rfc3339.is_some() {
        let s = start_rfc3339.ok_or("both start and end required for timed patch")?;
        let e = end_rfc3339.ok_or("both start and end required for timed patch")?;
        if s.trim().is_empty() || e.trim().is_empty() {
            return Err("timed patch: start/end must not be empty".into());
        }
        v["start"] = json!({ "dateTime": s.trim() });
        v["end"] = json!({ "dateTime": e.trim() });
    }

    Ok(v)
}

fn calendar_event_http_error(status: u16, text: &str, verb: &str) -> String {
    format!("Google Calendar events.{verb}: HTTP {status} — {text}")
}

/// GET calendar event JSON.
pub fn get_google_calendar_event(
    home: &Path,
    token_mailbox_id: &str,
    calendar_id: &str,
    event_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<Value, String> {
    let token = ensure_google_access_token(home, token_mailbox_id.trim(), env_file, process_env)
        .map_err(|e| e.to_string())?;
    let cid = urlencoding::encode(calendar_id.trim());
    let eid = urlencoding::encode(event_id.trim());
    let url = format!("{GCAL_EVENTS}/{cid}/events/{eid}");
    eprintln!("ripmail: Google Calendar get event (GET) …");
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("Google Calendar events.get (HTTP): {e}"))?;
    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| format!("Google Calendar events.get: read body: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(calendar_event_http_error(status, &text, "get"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Google Calendar events.get JSON: {e}: {text}"))
}

/// PATCH calendar event (`events.patch`).
#[allow(clippy::too_many_arguments)]
pub fn patch_google_calendar_event_json(
    home: &Path,
    token_mailbox_id: &str,
    calendar_id: &str,
    event_id: &str,
    body: &Value,
    send_updates_none: bool,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<Value, String> {
    let token = ensure_google_access_token(home, token_mailbox_id.trim(), env_file, process_env)
        .map_err(|e| e.to_string())?;
    let cid = urlencoding::encode(calendar_id.trim());
    let eid = urlencoding::encode(event_id.trim());
    let su = if send_updates_none {
        "sendUpdates=none"
    } else {
        "sendUpdates=all"
    };
    let url = format!("{GCAL_EVENTS}/{cid}/events/{eid}?{su}");
    let body_str = body.to_string();
    eprintln!("ripmail: Google Calendar patch event (PATCH) …");
    let resp = ureq::request("PATCH", &url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json; charset=utf-8")
        .send_string(&body_str)
        .map_err(|e| format!("Google Calendar events.patch (HTTP): {e}"))?;
    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| format!("Google Calendar events.patch: read body: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(calendar_event_http_error(status, &text, "patch"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Google Calendar response JSON: {e}: {text}"))
}

/// DELETE calendar event.
pub fn delete_google_calendar_event(
    home: &Path,
    token_mailbox_id: &str,
    calendar_id: &str,
    event_id: &str,
    send_updates_none: bool,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<(), String> {
    let token = ensure_google_access_token(home, token_mailbox_id.trim(), env_file, process_env)
        .map_err(|e| e.to_string())?;
    let cid = urlencoding::encode(calendar_id.trim());
    let eid = urlencoding::encode(event_id.trim());
    let su = if send_updates_none {
        "sendUpdates=none"
    } else {
        "sendUpdates=all"
    };
    let url = format!("{GCAL_EVENTS}/{cid}/events/{eid}?{su}");
    eprintln!("ripmail: Google Calendar delete event (DELETE) …");
    let resp = ureq::delete(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("Google Calendar events.delete (HTTP): {e}"))?;
    let status = resp.status();
    let text = resp.into_string().unwrap_or_default();
    if status == 204 || (200..300).contains(&status) {
        return Ok(());
    }
    Err(format!(
        "Google Calendar events.delete: HTTP {status} — {text}"
    ))
}

/// Shorten a recurring master's RRULE so occurrences strictly before `until_compact` remain.
pub fn recurrence_until_before_occurrence(
    rrule_lines: &[String],
    until_compact: &str,
) -> Result<Vec<String>, String> {
    let first = rrule_lines
        .first()
        .ok_or_else(|| "recurrence array is empty on master".to_string())?;
    let norm = normalize_rrule_line(first.as_str())?;
    let stripped = strip_rrule_count_until(&norm);
    let base = stripped.trim_end_matches(';').trim();
    Ok(vec![format!("{base};UNTIL={until_compact}")])
}

/// Best-effort original instance start from Google event JSON (`dateTime` or all-day `date`).
fn instance_original_start_rfc(inst: &Value) -> Option<String> {
    inst.pointer("/originalStartTime/dateTime")
        .and_then(|x| x.as_str())
        .map(String::from)
        .or_else(|| {
            inst.pointer("/originalStartTime/date")
                .and_then(|x| x.as_str())
                .map(|d| format!("{}T12:00:00Z", d.trim()))
        })
        .or_else(|| {
            inst.pointer("/start/dateTime")
                .and_then(|x| x.as_str())
                .map(String::from)
        })
        .or_else(|| {
            inst.pointer("/start/date")
                .and_then(|x| x.as_str())
                .map(|d| format!("{}T12:00:00Z", d.trim()))
        })
}

/// Parse RRULE ending date from instance `originalStartTime`/`start` minus one second → UNTIL value.
pub fn until_compact_truncating_before_original_start(
    orig_rfc3339: &str,
) -> Result<String, String> {
    let dt = chrono::DateTime::parse_from_rfc3339(orig_rfc3339.trim())
        .map_err(|e| format!("parse originalStartTime/start: {e}"))?;
    let cut = dt.with_timezone(&Utc) - Duration::seconds(1);
    Ok(format!("{}Z", cut.format("%Y%m%dT%H%M%S")))
}

pub fn truncate_recurring_master_before_instance(
    home: &Path,
    token_mailbox_id: &str,
    calendar_id: &str,
    instance_event_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<Value, String> {
    let inst = get_google_calendar_event(
        home,
        token_mailbox_id,
        calendar_id,
        instance_event_id,
        env_file,
        process_env,
    )?;
    let master_id = inst
        .get("recurringEventId")
        .and_then(|x| x.as_str())
        .ok_or_else(|| {
            "scope=future applies only to instances of recurring events (missing recurringEventId)"
                .to_string()
        })?;
    let orig = instance_original_start_rfc(&inst).ok_or_else(|| {
        "instance missing parseable originalStartTime/start (dateTime or date)".to_string()
    })?;
    let until = until_compact_truncating_before_original_start(&orig)?;
    let master = get_google_calendar_event(
        home,
        token_mailbox_id,
        calendar_id,
        master_id,
        env_file,
        process_env,
    )?;
    let rec_arr = master
        .get("recurrence")
        .and_then(|r| r.as_array())
        .ok_or("master missing recurrence rules")?;
    let lines: Vec<String> = rec_arr
        .iter()
        .filter_map(|x| x.as_str().map(String::from))
        .collect();
    let patched = recurrence_until_before_occurrence(&lines, &until)?;
    let body = json!({ "recurrence": patched });
    patch_google_calendar_event_json(
        home,
        token_mailbox_id,
        calendar_id,
        master_id,
        &body,
        false,
        env_file,
        process_env,
    )
}

pub fn google_calendar_cancel_future(
    home: &Path,
    token_mailbox_id: &str,
    calendar_id: &str,
    instance_event_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<Value, String> {
    truncate_recurring_master_before_instance(
        home,
        token_mailbox_id,
        calendar_id,
        instance_event_id,
        env_file,
        process_env,
    )
}

/// Build the JSON request body (exposed for unit tests).
pub fn build_google_calendar_event_insert_body(
    args: &InsertGoogleEventArgs<'_>,
) -> Result<Value, String> {
    if args.title.trim().is_empty() {
        return Err("title is required".into());
    }
    let mut v = json!({ "summary": args.title });
    if let Some(d) = args.description {
        if !d.trim().is_empty() {
            v["description"] = json!(d);
        }
    }
    if let Some(l) = args.location {
        if !l.trim().is_empty() {
            v["location"] = json!(l);
        }
    }
    if args.all_day {
        let d = args
            .all_day_date
            .ok_or("all-day events require --date (YYYY-MM-DD)")?;
        let start = NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d")
            .map_err(|e| format!("invalid --date: {e}"))?;
        let end = start
            .checked_add_days(Days::new(1))
            .ok_or("date overflow")?;
        v["start"] = json!({ "date": start.format("%Y-%m-%d").to_string() });
        v["end"] = json!({ "date": end.format("%Y-%m-%d").to_string() });
    } else {
        let s = args
            .start_rfc3339
            .ok_or("timed events require --start and --end (RFC3339)")?;
        let e = args
            .end_rfc3339
            .ok_or("timed events require --start and --end (RFC3339)")?;
        if s.trim().is_empty() || e.trim().is_empty() {
            return Err("start and end must be non-empty for timed events".into());
        }
        v["start"] = json!({ "dateTime": s.trim() });
        v["end"] = json!({ "dateTime": e.trim() });
    }
    if let Some(rec) = &args.recurrence {
        let arr = build_recurrence_json_array(rec)?;
        v["recurrence"] = serde_json::to_value(arr).map_err(|e| e.to_string())?;
    }
    Ok(v)
}

/// POST [events.insert](https://developers.google.com/calendar/api/v3/reference/events/insert) for a calendar.
pub fn insert_google_calendar_event(
    home: &Path,
    token_mailbox_id: &str,
    calendar_id: &str,
    args: &InsertGoogleEventArgs<'_>,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<Value, String> {
    let body = build_google_calendar_event_insert_body(args)?;
    let body_str = body.to_string();
    let token = ensure_google_access_token(home, token_mailbox_id.trim(), env_file, process_env)
        .map_err(|e| e.to_string())?;
    let cid = urlencoding::encode(calendar_id.trim());
    let url = format!("{GCAL_EVENTS}/{cid}/events?sendUpdates=none");
    eprintln!("ripmail: Google Calendar create event (POST) …");
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json; charset=utf-8")
        .send_string(&body_str)
        .map_err(|e| format!("Google Calendar events.insert (HTTP): {e}"))?;
    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| format!("Google Calendar events.insert: read body: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "Google Calendar events.insert: HTTP {status} — {text}"
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("Google Calendar response JSON: {e}: {text}"))
}

#[cfg(test)]
mod insert_tests {
    use super::{build_google_calendar_event_insert_body, InsertGoogleEventArgs};

    #[test]
    fn all_day_body_uses_exclusive_end() {
        let a = InsertGoogleEventArgs {
            title: "Trip",
            description: None,
            location: None,
            all_day: true,
            all_day_date: Some("2026-04-23"),
            start_rfc3339: None,
            end_rfc3339: None,
            recurrence: None,
        };
        let v = build_google_calendar_event_insert_body(&a).unwrap();
        assert_eq!(v["start"]["date"], "2026-04-23");
        assert_eq!(v["end"]["date"], "2026-04-24");
    }

    #[test]
    fn timed_body_uses_date_time() {
        let a = InsertGoogleEventArgs {
            title: "Meet",
            description: Some("x"),
            location: Some("HQ"),
            all_day: false,
            all_day_date: None,
            start_rfc3339: Some("2026-04-23T15:00:00-04:00"),
            end_rfc3339: Some("2026-04-23T16:00:00-04:00"),
            recurrence: None,
        };
        let v = build_google_calendar_event_insert_body(&a).unwrap();
        assert_eq!(v["start"]["dateTime"], "2026-04-23T15:00:00-04:00");
        assert_eq!(v["end"]["dateTime"], "2026-04-23T16:00:00-04:00");
    }

    #[test]
    fn insert_with_weekly_recurrence() {
        use super::{
            build_google_calendar_event_insert_body, InsertGoogleEventArgs, RecurrenceArgs,
        };
        let rec = RecurrenceArgs {
            preset: Some("weekly"),
            rrule: None,
            count: Some(10),
            until: None,
        };
        let a = InsertGoogleEventArgs {
            title: "Standup",
            description: None,
            location: None,
            all_day: false,
            all_day_date: None,
            start_rfc3339: Some("2026-04-23T15:00:00Z"),
            end_rfc3339: Some("2026-04-23T15:30:00Z"),
            recurrence: Some(rec),
        };
        let v = build_google_calendar_event_insert_body(&a).unwrap();
        let arr = v["recurrence"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert!(arr[0].as_str().unwrap().contains("FREQ=WEEKLY"));
        assert!(arr[0].as_str().unwrap().contains("COUNT=10"));
    }

    #[test]
    fn build_rrule_preset_and_raw_exclusive() {
        use super::{build_recurrence_json_array, RecurrenceArgs};
        let r = RecurrenceArgs {
            preset: Some("daily"),
            rrule: Some("FREQ=WEEKLY"),
            count: None,
            until: None,
        };
        assert!(build_recurrence_json_array(&r).is_err());
    }

    #[test]
    fn build_rrule_with_until() {
        use super::{build_recurrence_json_array, RecurrenceArgs};
        let r = RecurrenceArgs {
            preset: Some("weekly"),
            rrule: None,
            count: None,
            until: Some("2026-12-31"),
        };
        let a = build_recurrence_json_array(&r).unwrap();
        assert!(a[0].contains("UNTIL=20261231T235959Z"));
    }

    #[test]
    fn patch_body_title_only() {
        use super::build_google_calendar_event_patch_body;
        let v = build_google_calendar_event_patch_body(
            Some("Renamed"),
            None,
            None,
            None,
            None,
            false,
            None,
            None,
            false,
        )
        .unwrap();
        assert_eq!(v["summary"], "Renamed");
        assert!(!v.as_object().unwrap().contains_key("start"));
    }

    #[test]
    fn infer_master_strips_google_instance_suffix() {
        use super::infer_google_recurring_master_event_id;
        assert_eq!(
            infer_google_recurring_master_event_id("abcd_20260315T140000Z"),
            "abcd"
        );
        assert_eq!(infer_google_recurring_master_event_id("solo_id"), "solo_id");
    }
}
