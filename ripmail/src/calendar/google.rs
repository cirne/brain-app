//! Google Calendar API sync ([OPP-053](https://github.com/cirne/zmail)).

use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Duration, TimeZone, Utc};
use serde_json::Value;

use crate::oauth::ensure_google_access_token;

use super::db::{self, delete_source_events, upsert_event};
use super::model::CalendarEventRow;

type SyncResult = Result<(u32, Vec<String>, HashMap<String, String>), Box<dyn std::error::Error>>;

const GCAL_EVENTS: &str = "https://www.googleapis.com/calendar/v3/calendars";
const GCAL_LIST: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn parse_google_event(cal_id: &str, source_id: &str, v: &Value) -> Option<CalendarEventRow> {
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
        .map(String::from);
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

fn fetch_json(auth: &str, url: &str) -> Result<Value, Box<dyn std::error::Error>> {
    eprintln!("ripmail: fetching calendar JSON from {}", url);
    let resp = ureq::get(url)
        .set("Authorization", &format!("Bearer {auth}"))
        .call()?;
    let status = resp.status();
    let body = resp.into_string().unwrap_or_default();
    if status == 410 {
        return Err("gcal_410_sync_token".into());
    }
    if !(200..300).contains(&status) {
        eprintln!("ripmail: Google Calendar API error {}: {}", status, body);
        return Err(format!("Google Calendar API HTTP {status}: {body}").into());
    }
    Ok(serde_json::from_str(&body)?)
}

pub fn sync_google_calendars(
    conn: &mut rusqlite::Connection,
    home: &Path,
    source_id: &str,
    calendar_ids: &[String],
    token_mailbox_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> SyncResult {
    let token = ensure_google_access_token(home, token_mailbox_id, env_file, process_env).map_err(
        |e| {
            format!(
                "Google Calendar OAuth: {e}. Ensure `google-oauth.json` exists under \
                 RIPMAIL_HOME/{token_mailbox_id}/ (re-run `ripmail setup --google-oauth` or set oauth_source_id)."
            )
        },
    )?;

    let mut discovered_ids = Vec::new();
    let mut calendar_names: HashMap<String, String> = HashMap::new();

    // Calendar list: names for agents + **all** list entries are indexed (same idea as Apple:
    // everything is synced; `default_calendars` in config limits default CLI queries).
    if let Ok(val) = fetch_json(&token, GCAL_LIST) {
        if let Some(items) = val.get("items").and_then(|i| i.as_array()) {
            for item in items {
                if let Some(id) = item.get("id").and_then(|id| id.as_str()) {
                    discovered_ids.push(id.to_string());
                    if let Some(name) = item.get("summary").and_then(|s| s.as_str()) {
                        calendar_names.insert(id.to_string(), name.to_string());
                    }
                }
            }
        }
    }

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
    delete_source_events(&tx, source_id)?;
    let mut count: u32 = 0;
    let time_min = (Utc::now() - Duration::days(365 * 2)).to_rfc3339();
    let time_max = (Utc::now() + Duration::days(365 * 3)).to_rfc3339();

    for cal_id in &sync_calendar_ids {
        let cid_enc = urlencoding::encode(cal_id);
        let mut page_token: Option<String> = None;

        loop {
            let mut url = format!(
                "{GCAL_EVENTS}/{cid_enc}/events?singleEvents=true&maxResults=250&orderBy=startTime&timeMin={}&timeMax={}",
                urlencoding::encode(&time_min),
                urlencoding::encode(&time_max),
            );
            if let Some(ref p) = page_token {
                url.push_str("&pageToken=");
                url.push_str(&urlencoding::encode(p));
            }

            let val = match fetch_json(&token, &url) {
                Ok(v) => v,
                Err(e) => {
                    let s = e.to_string();
                    if s.contains("gcal_410") {
                        db::clear_sync_token(&tx, source_id, cal_id)?;
                    }
                    eprintln!("ripmail: skipping calendar {cal_id} due to error: {e}");
                    break; // Skip this calendar and continue with others
                }
            };

            if let Some(items) = val.get("items").and_then(|i| i.as_array()) {
                for item in items {
                    if let Some(mut row) = parse_google_event(cal_id, source_id, item) {
                        if let Some(n) = calendar_names.get(cal_id) {
                            row.calendar_name = Some(n.clone());
                        }
                        upsert_event(&tx, &row)?;
                        count += 1;
                    }
                }
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
                    db::set_sync_token(&tx, source_id, cal_id, Some(ns.as_str()))?;
                }
                break;
            }
        }
    }

    tx.commit()?;
    Ok((count, discovered_ids, calendar_names))
}
