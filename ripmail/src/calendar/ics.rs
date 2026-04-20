//! Parse iCalendar (.ics) into [`CalendarEventRow`](super::model::CalendarEventRow).

use chrono::{NaiveDate, TimeZone, Utc};

use super::model::CalendarEventRow;

fn unfold(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for line in raw.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            out.push_str(line.trim_start_matches([' ', '\t']));
        } else {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line);
        }
    }
    out
}

fn parse_datetime_prop(line: &str) -> Option<(bool, i64, Option<String>)> {
    let rest = line.rfind(':').map(|i| &line[i + 1..])?.trim();
    let is_date =
        line.to_uppercase().contains("VALUE=DATE") || (rest.len() == 8 && !rest.contains('T'));
    if is_date && rest.len() == 8 {
        let nd = NaiveDate::parse_from_str(rest, "%Y%m%d").ok()?;
        let start = nd.and_hms_opt(0, 0, 0)?;
        let s = Utc.from_utc_datetime(&start).timestamp();
        return Some((true, s, None));
    }
    let r = rest.trim_end_matches('Z');
    if rest.ends_with('Z') && rest.contains('T') {
        if let Ok(n) = chrono::NaiveDateTime::parse_from_str(r, "%Y%m%dT%H%M%S") {
            let ts = Utc.from_utc_datetime(&n).timestamp();
            return Some((false, ts, Some("UTC".into())));
        }
    }
    if rest.contains('T') && rest.len() >= 15 {
        if let Ok(n) = chrono::NaiveDateTime::parse_from_str(rest, "%Y%m%dT%H%M%S") {
            let ts = Utc.from_utc_datetime(&n).timestamp();
            return Some((false, ts, None));
        }
    }
    None
}

fn line_value<'a>(block: &'a str, key: &str) -> Option<&'a str> {
    for l in block.lines() {
        let l = l.trim_end();
        if l.to_uppercase()
            .starts_with(&format!("{}:", key.to_uppercase()))
        {
            return l.split_once(':').map(|(_, v)| v);
        }
        if l.to_uppercase()
            .starts_with(&format!("{};", key.to_uppercase()))
        {
            if let Some(i) = l.rfind(':') {
                return Some(&l[i + 1..]);
            }
        }
    }
    None
}

/// Parse raw ICS bytes into event rows for `source_id` / `source_kind` / `calendar_id`.
pub fn parse_ics_to_rows(
    raw: &str,
    source_id: &str,
    source_kind: &str,
    calendar_id: &str,
) -> Vec<CalendarEventRow> {
    let text = unfold(raw);
    let mut out = Vec::new();
    let upper = text.to_uppercase();
    let mut start = 0usize;
    while let Some(pos) = upper[start..].find("BEGIN:VEVENT") {
        let block_start = start + pos;
        if let Some(end_rel) = upper[block_start..].find("END:VEVENT") {
            let block = &text[block_start..block_start + end_rel];
            if let Some(uid) = line_value(block, "UID").map(str::trim) {
                let mut summary = line_value(block, "SUMMARY")
                    .map(str::trim)
                    .map(String::from);
                let description = line_value(block, "DESCRIPTION")
                    .map(str::trim)
                    .map(String::from);
                let location = line_value(block, "LOCATION")
                    .map(str::trim)
                    .map(String::from);
                let mut dtstart_line = None;
                let mut dtend_line = None;
                for l in block.lines() {
                    let ul = l.trim().to_uppercase();
                    if ul.starts_with("DTSTART") {
                        dtstart_line = Some(l);
                    }
                    if ul.starts_with("DTEND") {
                        dtend_line = Some(l);
                    }
                }
                let (all_day, start_at, tz) =
                    if let Some(dl) = dtstart_line.and_then(parse_datetime_prop) {
                        dl
                    } else {
                        continue;
                    };
                let mut end_at = dtend_line
                    .and_then(parse_datetime_prop)
                    .map(|(_, t, _)| t)
                    .unwrap_or(start_at + 3600);
                if all_day {
                    // end exclusive: DTEND date is next day in ICS
                    if let Some(dl) = dtend_line.and_then(parse_datetime_prop) {
                        end_at = dl.1;
                    } else {
                        end_at = start_at + 86400;
                    }
                }
                let uid_owned = uid.to_string();
                if summary.as_deref().unwrap_or("").is_empty() {
                    summary = Some("(no title)".to_string());
                }
                out.push(CalendarEventRow {
                    source_id: source_id.to_string(),
                    source_kind: source_kind.to_string(),
                    calendar_id: calendar_id.to_string(),
                    calendar_name: None,
                    uid: uid_owned,
                    summary,
                    description,
                    location,
                    start_at,
                    end_at,
                    all_day,
                    timezone: tz,
                    status: line_value(block, "STATUS").map(str::trim).map(String::from),
                    rrule: line_value(block, "RRULE").map(str::trim).map(String::from),
                    recurrence_json: None,
                    attendees_json: None,
                    organizer_email: None,
                    organizer_name: None,
                    updated_at: None,
                    synced_at: None,
                    color: None,
                    raw_json: None,
                });
            }
            start = block_start + end_rel + "END:VEVENT".len();
        } else {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_vevent() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:test@x\r\nDTSTART:20260420T150000Z\r\nDTEND:20260420T160000Z\r\nSUMMARY:Hello\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let rows = parse_ics_to_rows(ics, "s1", "icsFile", "default");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uid, "test@x");
        assert_eq!(rows[0].summary.as_deref(), Some("Hello"));
        assert!(!rows[0].all_day);
    }

    #[test]
    fn parse_all_day_vevent() {
        let ics = "BEGIN:VEVENT\r\nUID:allday1\r\nDTSTART;VALUE=DATE:20260420\r\nDTEND;VALUE=DATE:20260421\r\nSUMMARY:Away\r\nEND:VEVENT\r\n";
        let rows = parse_ics_to_rows(ics, "s1", "icsSubscription", "pub");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].all_day);
        assert_eq!(rows[0].summary.as_deref(), Some("Away"));
        assert!(rows[0].end_at >= rows[0].start_at);
    }
}
