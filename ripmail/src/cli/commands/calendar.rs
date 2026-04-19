//! `ripmail calendar` — query indexed events ([OPP-053](https://github.com/cirne/zmail)).

use chrono::{Days, NaiveDate, TimeZone, Utc};

use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::calendar::{
    fetch_event_json_by_rowid, fetch_event_json_by_uid, list_events_in_range,
    list_events_overlapping, search_events_fts,
};
use ripmail::config::{load_config_json, SourceKind};
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

fn kind_str(k: SourceKind) -> &'static str {
    match k {
        SourceKind::Imap => "imap",
        SourceKind::AppleMail => "applemail",
        SourceKind::LocalDir => "localDir",
        SourceKind::GoogleCalendar => "googleCalendar",
        SourceKind::AppleCalendar => "appleCalendar",
        SourceKind::IcsSubscription => "icsSubscription",
        SourceKind::IcsFile => "icsFile",
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
                serde_json::json!({
                    "sourceId": s.id,
                    "kind": kind_str(s.kind),
                    "calendarIds": s.calendar_ids,
                    "icsUrl": s.ics_url,
                    "path": s.path,
                    "email": s.email,
                })
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
    let conn = db::open_file(cfg.db_path())?;
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
            let rows = list_events_in_range(conn, source.as_deref(), lo, hi, 200)?;
            print_json_array(&rows, json)
        }
        CalendarCmd::Upcoming { days, source, json } => {
            let now = Utc::now().timestamp();
            let end_ts = now + (days as i64) * 86400;
            let rows = list_events_in_range(conn, source.as_deref(), now, end_ts, 200)?;
            print_json_array(&rows, json)
        }
        CalendarCmd::Range {
            from,
            to,
            source,
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
            let rows = list_events_overlapping(conn, source.as_deref(), lo, hi, 2000)?;
            print_json_array(&rows, json)
        }
        CalendarCmd::Search {
            query,
            from,
            to,
            source,
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

            let ids =
                search_events_fts(conn, &query, source.as_deref(), start_min, start_max, 100)?;
            let mut out: Vec<String> = Vec::new();
            for id in ids {
                if let Some(j) = fetch_event_json_by_rowid(conn, id)? {
                    out.push(j);
                }
            }
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
