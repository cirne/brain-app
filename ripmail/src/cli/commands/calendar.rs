//! `ripmail calendar` — query indexed events ([OPP-053](https://github.com/cirne/zmail)).

use std::collections::HashMap;

use chrono::{Days, NaiveDate, TimeZone, Utc};

use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::calendar::{
    fetch_event_json_by_rowid, fetch_event_json_by_uid, list_events_overlapping_scoped,
    search_calendar_events_with_scope, CalendarQueryScope,
};
use ripmail::config::{load_config_json, SourceConfigJson, SourceKind};
use ripmail::db;

use crate::cli::args::CalendarCmd;

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
                let names: HashMap<String, String> = std::fs::read_to_string(&names_path)
                    .ok()
                    .and_then(|c| serde_json::from_str(&c).ok())
                    .unwrap_or_default();

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
    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    run_calendar_with_conn(&conn, cmd)
}

fn run_calendar_with_conn(conn: &rusqlite::Connection, cmd: CalendarCmd) -> CliResult {
    match cmd {
        CalendarCmd::ListCalendars { .. } => {
            unreachable!("list-calendars is handled in run_calendar before opening the DB")
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
