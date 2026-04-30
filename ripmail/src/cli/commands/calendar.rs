//! `ripmail calendar` — query indexed events ([OPP-053](https://github.com/cirne/zmail)).

use std::collections::HashMap;

use chrono::{Days, NaiveDate, TimeZone, Utc};

use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::calendar::{
    build_google_calendar_event_patch_body, delete_google_calendar_event,
    fetch_event_json_by_rowid, fetch_event_json_by_uid, fetch_google_calendar_names_api,
    google_calendar_cancel_future, infer_google_recurring_master_event_id,
    insert_google_calendar_event, list_events_overlapping_scoped, patch_google_calendar_event_json,
    search_calendar_events_with_scope, CalendarQueryScope, InsertGoogleEventArgs, RecurrenceArgs,
};
use ripmail::config::{
    load_config_json, read_ripmail_env_file, resolve_source_spec, CalendarSourceResolved,
    SourceConfigJson, SourceKind,
};
use ripmail::db;

use crate::cli::args::{CalendarCmd, CancelMutationScopeCli, DeleteMutationScopeCli};

fn parse_ymd(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| {
        format!(
            "invalid date {s:?} (expected YYYY-MM-DD, e.g. {})",
            Utc::now().format("%Y-%m-%d")
        )
    })
}

/// `default_calendars` entries for Google / Apple sources (drives default queries only).
fn default_calendar_restrictions(sources: &[SourceConfigJson]) -> Vec<(String, Vec<String>)> {
    sources
        .iter()
        .filter(|s| {
            matches!(
                s.kind,
                SourceKind::GoogleCalendar | SourceKind::AppleCalendar
            )
        })
        .filter_map(|s| {
            let d = s.default_calendars.as_ref()?;
            if d.is_empty() {
                None
            } else {
                Some((s.id.clone(), d.clone()))
            }
        })
        .collect()
}

fn scope_for_calendar_query<'a>(
    source: Option<&'a str>,
    explicit_calendars: &'a [String],
    sources: &'a [SourceConfigJson],
    restrictions: &'a [(String, Vec<String>)],
) -> CalendarQueryScope<'a> {
    if !explicit_calendars.is_empty() {
        return match source {
            Some(sid) => CalendarQueryScope::Source {
                source_id: sid,
                calendar_ids: explicit_calendars,
            },
            None => CalendarQueryScope::GlobalCalendars(explicit_calendars),
        };
    }

    match source {
        Some(sid) => {
            let defaults = sources
                .iter()
                .find(|s| s.id == sid || s.email == sid)
                .and_then(|s| s.default_calendars.as_ref())
                .filter(|d| !d.is_empty());
            match defaults {
                Some(d) => CalendarQueryScope::Source {
                    source_id: sid,
                    calendar_ids: d.as_slice(),
                },
                None => CalendarQueryScope::Source {
                    source_id: sid,
                    calendar_ids: &[],
                },
            }
        }
        None => {
            if restrictions.is_empty() {
                CalendarQueryScope::All
            } else {
                CalendarQueryScope::PerSourceDefaultCalendars(restrictions)
            }
        }
    }
}

fn fts_source_for_scope<'a>(scope: &'a CalendarQueryScope<'a>) -> Option<&'a str> {
    match scope {
        CalendarQueryScope::Source { source_id, .. } => Some(*source_id),
        _ => None,
    }
}

fn kind_str(k: SourceKind) -> &'static str {
    match k {
        SourceKind::Imap => "imap",
        SourceKind::AppleMail => "applemail",
        SourceKind::LocalDir => "localDir",
        SourceKind::GoogleCalendar => "googleCalendar",
        SourceKind::AppleCalendar => "appleCalendar",
        SourceKind::IcsSubscription => "icsSubscription",
        SourceKind::IcsFile => "icsFile",
        SourceKind::GoogleDrive => "googleDrive",
    }
}

pub(crate) fn run_calendar(cmd: CalendarCmd) -> CliResult {
    if let CalendarCmd::ListCalendars { source, json } = cmd {
        let home = ripmail_home_path();
        let cfgj = load_config_json(&home);
        let cfg = load_cfg();
        let env_file = read_ripmail_env_file(&home);
        let process_env: HashMap<String, String> = std::env::vars().collect();
        let sources = cfgj.sources.unwrap_or_default();
        let rows: Vec<serde_json::Value> = sources
            .into_iter()
            .filter(|s| {
                matches!(
                    s.kind,
                    SourceKind::GoogleCalendar
                        | SourceKind::AppleCalendar
                        | SourceKind::IcsSubscription
                        | SourceKind::IcsFile
                )
            })
            .filter(|s| {
                source
                    .as_ref()
                    .map(|spec| s.id == *spec || s.email == *spec)
                    .unwrap_or(true)
            })
            .map(|s| {
                let names_path = home.join(&s.id).join("calendar-names.json");
                let mut names: HashMap<String, String> = std::fs::read_to_string(&names_path)
                    .ok()
                    .and_then(|c| serde_json::from_str(&c).ok())
                    .unwrap_or_default();

                // For Google Calendar sources: live-fetch names from the API when the local
                // cache is missing or empty (e.g. before the first sync).
                if names.is_empty() && s.kind == SourceKind::GoogleCalendar {
                    if let Some(resolved) = resolve_source_spec(&cfg.resolved_sources, &s.id) {
                        if let Some(CalendarSourceResolved::Google {
                            token_mailbox_id, ..
                        }) = resolved.calendar.as_ref()
                        {
                            if let Ok(fetched) = fetch_google_calendar_names_api(
                                &home,
                                token_mailbox_id,
                                &env_file,
                                &process_env,
                            ) {
                                if !fetched.is_empty() {
                                    // Persist for future calls (same path as sync).
                                    let dir = home.join(&s.id);
                                    let _ = std::fs::create_dir_all(&dir);
                                    if let Ok(j) = serde_json::to_string_pretty(&fetched) {
                                        let _ = std::fs::write(dir.join("calendar-names.json"), j);
                                    }
                                    names = fetched;
                                }
                            }
                        }
                    }
                }

                let calendar_ids_with_names: Vec<serde_json::Value> = s
                    .calendar_ids
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .map(|id| {
                        let mut obj = serde_json::json!({ "id": id });
                        if let Some(name) = names.get(id) {
                            obj["name"] = serde_json::Value::String(name.clone());
                        }
                        obj
                    })
                    .collect();

                let all_calendars: Vec<serde_json::Value> = names
                    .iter()
                    .map(|(id, name)| serde_json::json!({ "id": id, "name": name }))
                    .collect();

                let mut obj = serde_json::json!({
                    "sourceId": s.id,
                    "kind": kind_str(s.kind),
                    "calendars": calendar_ids_with_names,
                    "icsUrl": s.ics_url,
                    "path": s.path,
                    "email": s.email,
                });
                if !all_calendars.is_empty() {
                    obj["allCalendars"] = serde_json::Value::Array(all_calendars);
                }
                obj
            })
            .collect();
        if json {
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({ "calendars": rows }))?
            );
        } else if rows.is_empty() {
            println!("(no calendar sources; use `ripmail sources add --kind …`)");
        } else {
            for r in &rows {
                println!("{}", serde_json::to_string(r)?);
            }
        }
        return Ok(());
    }
    if let CalendarCmd::CreateEvent {
        source,
        calendar,
        title,
        all_day,
        date,
        start,
        end,
        description,
        location,
        recurrence_preset,
        rrule,
        recurrence_count,
        recurrence_until,
        json,
    } = cmd
    {
        return run_calendar_create_event(
            source,
            calendar,
            title,
            all_day,
            date,
            start,
            end,
            description,
            location,
            recurrence_preset,
            rrule,
            recurrence_count,
            recurrence_until,
            json,
        );
    }

    if let CalendarCmd::UpdateEvent {
        source,
        calendar,
        event_id,
        title,
        description,
        location,
        all_day,
        date,
        start,
        end,
        recurrence_preset,
        rrule,
        recurrence_count,
        recurrence_until,
        json,
    } = cmd
    {
        return run_calendar_update_event(
            source,
            calendar,
            event_id,
            title,
            description,
            location,
            all_day,
            date,
            start,
            end,
            recurrence_preset,
            rrule,
            recurrence_count,
            recurrence_until,
            json,
        );
    }

    if let CalendarCmd::CancelEvent {
        source,
        calendar,
        event_id,
        scope,
        json,
    } = cmd
    {
        return run_calendar_cancel_event(source, calendar, event_id, scope, json);
    }

    if let CalendarCmd::DeleteEvent {
        source,
        calendar,
        event_id,
        scope,
        json,
    } = cmd
    {
        return run_calendar_delete_event(source, calendar, event_id, scope, json);
    }
    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    run_calendar_with_conn(&conn, cmd)
}

fn resolve_google_calendar_token_mailbox(source: &str) -> Result<String, String> {
    let cfg = load_cfg();
    let Some(rs) = resolve_source_spec(&cfg.resolved_sources, source.trim()) else {
        return Err(format!("Unknown source: {}", source.trim()));
    };
    if rs.kind != SourceKind::GoogleCalendar {
        return Err(
            "unsupported_source: mutations require googleCalendar (Google Calendar via OAuth)"
                .into(),
        );
    }
    match &rs.calendar {
        Some(CalendarSourceResolved::Google {
            token_mailbox_id, ..
        }) => Ok(token_mailbox_id.clone()),
        _ => Err("internal: google calendar missing OAuth mailbox id".into()),
    }
}

fn envelope_mutation_json(v: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "eventId": v.get("id").and_then(|x| x.as_str()).unwrap_or(""),
        "htmlLink": v.get("htmlLink").and_then(|x| x.as_str()).unwrap_or(""),
    })
}

#[allow(clippy::too_many_arguments)]
fn run_calendar_create_event(
    source: String,
    calendar: String,
    title: String,
    all_day: bool,
    date: Option<String>,
    start: Option<String>,
    end: Option<String>,
    description: Option<String>,
    location: Option<String>,
    recurrence_preset: Option<String>,
    rrule: Option<String>,
    recurrence_count: Option<u32>,
    recurrence_until: Option<String>,
    json: bool,
) -> CliResult {
    let home = ripmail_home_path();
    let token_mailbox_id = resolve_google_calendar_token_mailbox(&source)?;
    if all_day && (start.is_some() || end.is_some()) {
        return Err("use either --all-day with --date, or --start/--end (timed) — not both".into());
    }
    if !all_day && date.is_some() {
        return Err("omit --date for timed events; use --start and --end (RFC3339).".into());
    }
    let desc = description.as_deref();
    let loc = location.as_deref();
    let recurrence = if recurrence_preset.is_some()
        || rrule.is_some()
        || recurrence_count.is_some()
        || recurrence_until.is_some()
    {
        Some(RecurrenceArgs {
            preset: recurrence_preset.as_deref(),
            rrule: rrule.as_deref(),
            count: recurrence_count,
            until: recurrence_until.as_deref(),
        })
    } else {
        None
    };
    let args = InsertGoogleEventArgs {
        title: title.as_str(),
        description: desc,
        location: loc,
        all_day,
        all_day_date: date.as_deref(),
        start_rfc3339: start.as_deref(),
        end_rfc3339: end.as_deref(),
        recurrence,
    };
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let out = insert_google_calendar_event(
        &home,
        &token_mailbox_id,
        calendar.trim(),
        &args,
        &env_file,
        &process_env,
    )
    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "ok": true,
                "eventId": out.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "htmlLink": out.get("htmlLink").and_then(|v| v.as_str()).unwrap_or(""),
                "raw": out
            }))?
        );
    } else {
        let id = out.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        let link = out.get("htmlLink").and_then(|v| v.as_str()).unwrap_or("");
        if !link.is_empty() {
            println!("Created event {id}\n{link}");
        } else {
            println!("Created event {id}");
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_calendar_update_event(
    source: String,
    calendar: String,
    event_id: String,
    title: Option<String>,
    description: Option<String>,
    location: Option<String>,
    all_day: bool,
    date: Option<String>,
    start: Option<String>,
    end: Option<String>,
    recurrence_preset: Option<String>,
    rrule: Option<String>,
    recurrence_count: Option<u32>,
    recurrence_until: Option<String>,
    json: bool,
) -> CliResult {
    let home = ripmail_home_path();
    let token_mailbox_id = resolve_google_calendar_token_mailbox(&source)?;

    let has_patch = title.is_some()
        || description.is_some()
        || location.is_some()
        || recurrence_preset.is_some()
        || rrule.is_some()
        || recurrence_count.is_some()
        || recurrence_until.is_some()
        || all_day
        || start.is_some()
        || end.is_some();

    if !has_patch {
        return Err(
            "update-event needs at least one of --title, --description, --location, recurrence flags, timed --start/--end, or --all-day --date"
                .into(),
        );
    }

    let recurrence_patch = if recurrence_preset.is_some()
        || rrule.is_some()
        || recurrence_count.is_some()
        || recurrence_until.is_some()
    {
        Some(RecurrenceArgs {
            preset: recurrence_preset.as_deref(),
            rrule: rrule.as_deref(),
            count: recurrence_count,
            until: recurrence_until.as_deref(),
        })
    } else {
        None
    };

    let body = build_google_calendar_event_patch_body(
        title.as_deref(),
        description.as_deref(),
        location.as_deref(),
        start.as_deref(),
        end.as_deref(),
        all_day,
        date.as_deref(),
        recurrence_patch,
        false,
    )
    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let eid_trim = event_id.trim();
    let out = patch_google_calendar_event_json(
        &home,
        &token_mailbox_id,
        calendar.trim(),
        eid_trim,
        &body,
        false,
        &env_file,
        &process_env,
    )
    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&envelope_mutation_json(&out))?
        );
    } else {
        println!(
            "Updated event {}",
            out.get("id").and_then(|v| v.as_str()).unwrap_or(eid_trim)
        );
    }
    Ok(())
}

fn run_calendar_cancel_event(
    source: String,
    calendar: String,
    event_id: String,
    scope: Option<CancelMutationScopeCli>,
    json: bool,
) -> CliResult {
    let home = ripmail_home_path();
    let token_mailbox_id = resolve_google_calendar_token_mailbox(&source)?;
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let cid = calendar.trim();
    let eid = event_id.trim();
    let sc = scope.unwrap_or(CancelMutationScopeCli::This);

    let out = match sc {
        CancelMutationScopeCli::Future => google_calendar_cancel_future(
            &home,
            &token_mailbox_id,
            cid,
            eid,
            &env_file,
            &process_env,
        ),
        CancelMutationScopeCli::This => {
            let body = serde_json::json!({ "status": "cancelled" });
            patch_google_calendar_event_json(
                &home,
                &token_mailbox_id,
                cid,
                eid,
                &body,
                false,
                &env_file,
                &process_env,
            )
        }
        CancelMutationScopeCli::All => {
            let master = infer_google_recurring_master_event_id(eid);
            let body = serde_json::json!({ "status": "cancelled" });
            patch_google_calendar_event_json(
                &home,
                &token_mailbox_id,
                cid,
                master,
                &body,
                false,
                &env_file,
                &process_env,
            )
        }
    }
    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&envelope_mutation_json(&out))?
        );
    } else {
        println!(
            "Cancelled event {}",
            out.get("id").and_then(|v| v.as_str()).unwrap_or(eid)
        );
    }
    Ok(())
}

fn run_calendar_delete_event(
    source: String,
    calendar: String,
    event_id: String,
    scope: Option<DeleteMutationScopeCli>,
    json: bool,
) -> CliResult {
    let home = ripmail_home_path();
    let token_mailbox_id = resolve_google_calendar_token_mailbox(&source)?;
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let cid = calendar.trim();
    let eid = event_id.trim();
    let target = match scope.unwrap_or(DeleteMutationScopeCli::This) {
        DeleteMutationScopeCli::This => eid.to_string(),
        DeleteMutationScopeCli::All => infer_google_recurring_master_event_id(eid).to_string(),
    };
    delete_google_calendar_event(
        &home,
        &token_mailbox_id,
        cid,
        target.as_str(),
        false,
        &env_file,
        &process_env,
    )
    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "ok": true,
                "eventId": target.as_str(),
                "htmlLink": ""
            }))?
        );
    } else {
        println!("Deleted event {target}");
    }
    Ok(())
}

fn run_calendar_with_conn(conn: &rusqlite::Connection, cmd: CalendarCmd) -> CliResult {
    match cmd {
        CalendarCmd::ListCalendars { .. } => {
            unreachable!("list-calendars is handled in run_calendar before opening the DB")
        }
        CalendarCmd::CreateEvent { .. } => {
            unreachable!("create-event is handled in run_calendar before opening the DB")
        }
        CalendarCmd::UpdateEvent { .. } => {
            unreachable!("update-event is handled in run_calendar before opening the DB")
        }
        CalendarCmd::CancelEvent { .. } => {
            unreachable!("cancel-event is handled in run_calendar before opening the DB")
        }
        CalendarCmd::DeleteEvent { .. } => {
            unreachable!("delete-event is handled in run_calendar before opening the DB")
        }
        CalendarCmd::Today { source, json } => {
            let now = Utc::now().date_naive();
            let start = now.and_hms_opt(0, 0, 0).unwrap();
            let end = now
                .checked_add_days(Days::new(1))
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap();
            let lo = Utc.from_utc_datetime(&start).timestamp();
            let hi = Utc.from_utc_datetime(&end).timestamp();

            let home = ripmail_home_path();
            let cfg = load_config_json(&home);
            let sources = cfg.sources.unwrap_or_default();
            let restrictions = default_calendar_restrictions(&sources);
            let scope = scope_for_calendar_query(source.as_deref(), &[], &sources, &restrictions);
            let rows = list_events_overlapping_scoped(conn, scope, lo, hi, 200)?;
            print_json_array(&rows, json)
        }
        CalendarCmd::Upcoming { days, source, json } => {
            let now = Utc::now().timestamp();
            let end_ts = now + (days as i64) * 86400;

            let home = ripmail_home_path();
            let cfg = load_config_json(&home);
            let sources = cfg.sources.unwrap_or_default();
            let restrictions = default_calendar_restrictions(&sources);
            let scope = scope_for_calendar_query(source.as_deref(), &[], &sources, &restrictions);
            let rows = list_events_overlapping_scoped(conn, scope, now, end_ts, 200)?;
            print_json_array(&rows, json)
        }
        CalendarCmd::Range {
            from,
            to,
            source,
            calendar,
            json,
        } => {
            let from_d = parse_ymd(&from)?;
            let to_d = parse_ymd(&to)?;
            let lo = Utc
                .from_utc_datetime(&from_d.and_hms_opt(0, 0, 0).unwrap())
                .timestamp();
            let hi = Utc
                .from_utc_datetime(
                    &to_d
                        .checked_add_days(Days::new(1))
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap(),
                )
                .timestamp();

            let home = ripmail_home_path();
            let cfg = load_config_json(&home);
            let sources = cfg.sources.unwrap_or_default();
            let restrictions = default_calendar_restrictions(&sources);
            let scope =
                scope_for_calendar_query(source.as_deref(), &calendar, &sources, &restrictions);
            let rows = list_events_overlapping_scoped(conn, scope, lo, hi, 2000)?;
            print_json_array(&rows, json)
        }
        CalendarCmd::Search {
            query,
            from,
            to,
            source,
            calendar,
            json,
        } => {
            let start_min = from.as_deref().map(parse_ymd).transpose()?.map(|d| {
                Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                    .timestamp()
            });
            let start_max = to
                .as_deref()
                .map(parse_ymd)
                .transpose()?
                .map(|d| {
                    d.checked_add_days(Days::new(1))
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                })
                .map(|d| Utc.from_utc_datetime(&d).timestamp());

            let home = ripmail_home_path();
            let cfg = load_config_json(&home);
            let sources = cfg.sources.unwrap_or_default();
            let restrictions = default_calendar_restrictions(&sources);
            let scope =
                scope_for_calendar_query(source.as_deref(), &calendar, &sources, &restrictions);
            let fts_source = fts_source_for_scope(&scope);
            let out = search_calendar_events_with_scope(
                conn, &query, &scope, fts_source, start_min, start_max, 100,
            )?;
            print_json_array(&out, json)
        }
        CalendarCmd::Read {
            target,
            source,
            json: _,
        } => {
            let sid = source
                .as_deref()
                .ok_or("--source is required for `calendar read`")?;
            let out = if let Ok(rid) = target.parse::<i64>() {
                fetch_event_json_by_rowid(conn, rid)?
            } else {
                fetch_event_json_by_uid(conn, sid, &target)?
            }
            .ok_or_else(|| format!("event not found: {target:?}"))?;
            println!("{}", out);
            Ok(())
        }
    }
}

fn print_json_array(rows: &[String], json: bool) -> CliResult {
    if json {
        let arr: Vec<serde_json::Value> = rows
            .iter()
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect();
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({ "events": arr }))?
        );
    } else {
        for line in rows {
            println!("{line}");
        }
    }
    Ok(())
}
