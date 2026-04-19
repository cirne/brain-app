//! Persist calendar rows into SQLite ([OPP-053](https://github.com/cirne/zmail)).

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

use super::model::CalendarEventRow;

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn delete_source_events(conn: &Connection, source_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM calendar_events WHERE source_id = ?1",
        [source_id],
    )
}

/// Insert or replace one row (fires FTS triggers).
pub fn upsert_event(conn: &Connection, row: &CalendarEventRow) -> rusqlite::Result<()> {
    let synced_at = row.synced_at.unwrap_or_else(now_unix);
    conn.execute(
        "INSERT INTO calendar_events (
            source_id, source_kind, calendar_id, uid, summary, description, location,
            start_at, end_at, all_day, timezone, status, rrule, recurrence_json, attendees_json,
            organizer_email, organizer_name, updated_at, synced_at, color, raw_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
        ON CONFLICT(source_id, uid) DO UPDATE SET
            source_kind = excluded.source_kind,
            calendar_id = excluded.calendar_id,
            summary = excluded.summary,
            description = excluded.description,
            location = excluded.location,
            start_at = excluded.start_at,
            end_at = excluded.end_at,
            all_day = excluded.all_day,
            timezone = excluded.timezone,
            status = excluded.status,
            rrule = excluded.rrule,
            recurrence_json = excluded.recurrence_json,
            attendees_json = excluded.attendees_json,
            organizer_email = excluded.organizer_email,
            organizer_name = excluded.organizer_name,
            updated_at = excluded.updated_at,
            synced_at = excluded.synced_at,
            color = excluded.color,
            raw_json = excluded.raw_json",
        params![
            &row.source_id,
            &row.source_kind,
            &row.calendar_id,
            &row.uid,
            &row.summary,
            &row.description,
            &row.location,
            row.start_at,
            row.end_at,
            row.all_day as i64,
            &row.timezone,
            &row.status,
            &row.rrule,
            &row.recurrence_json,
            &row.attendees_json,
            &row.organizer_email,
            &row.organizer_name,
            row.updated_at,
            synced_at,
            &row.color,
            &row.raw_json,
        ],
    )?;
    Ok(())
}

pub fn get_sync_token(
    conn: &Connection,
    source_id: &str,
    calendar_id: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT sync_token FROM calendar_sync_state WHERE source_id = ?1 AND calendar_id = ?2",
        params![source_id, calendar_id],
        |r| r.get(0),
    )
    .optional()
}

pub fn set_sync_token(
    conn: &Connection,
    source_id: &str,
    calendar_id: &str,
    sync_token: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_unix();
    conn.execute(
        "INSERT INTO calendar_sync_state (source_id, calendar_id, sync_token, synced_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_id, calendar_id) DO UPDATE SET
           sync_token = excluded.sync_token,
           synced_at = excluded.synced_at",
        params![source_id, calendar_id, sync_token, now],
    )?;
    Ok(())
}

pub fn clear_sync_token(
    conn: &Connection,
    source_id: &str,
    calendar_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM calendar_sync_state WHERE source_id = ?1 AND calendar_id = ?2",
        params![source_id, calendar_id],
    )?;
    Ok(())
}

pub fn upsert_source_registry(
    conn: &Connection,
    source_id: &str,
    kind: &str,
    include_in_default: bool,
    doc_count: i64,
) -> rusqlite::Result<()> {
    let inc = if include_in_default { 1 } else { 0 };
    conn.execute(
        "INSERT INTO sources (id, kind, label, include_in_default, last_synced_at, doc_count)
         VALUES (?1, ?2, NULL, ?3, datetime('now'), ?4)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           include_in_default = excluded.include_in_default,
           last_synced_at = excluded.last_synced_at,
           doc_count = excluded.doc_count",
        params![source_id, kind, inc, doc_count],
    )?;
    Ok(())
}

pub fn count_events_for_source(conn: &Connection, source_id: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM calendar_events WHERE source_id = ?1",
        [source_id],
        |r| r.get(0),
    )
}

fn fts_match_literal(query: &str) -> String {
    let q = query.trim();
    if q.is_empty() {
        return "*".to_string();
    }
    // FTS5: phrase query — quote and escape internal quotes
    format!("\"{}\"", q.replace('\"', "\"\""))
}

/// Full-text search; `query` matched against summary/description/location via FTS5.
pub fn search_events_fts(
    conn: &Connection,
    query: &str,
    source_id: Option<&str>,
    start_min: Option<i64>,
    start_max: Option<i64>,
    limit: usize,
) -> rusqlite::Result<Vec<i64>> {
    let lim = limit.clamp(1, 500) as i64;
    let m = fts_match_literal(query);
    let mut ids: Vec<i64> = Vec::new();
    match (source_id, start_min, start_max) {
        (Some(sid), Some(lo), Some(hi)) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.source_id = ?2
                   AND e.start_at >= ?3 AND e.start_at <= ?4
                 ORDER BY e.start_at ASC LIMIT ?5",
            )?;
            for row in s.query_map(params![m, sid, lo, hi, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (Some(sid), Some(lo), None) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.source_id = ?2 AND e.start_at >= ?3
                 ORDER BY e.start_at ASC LIMIT ?4",
            )?;
            for row in s.query_map(params![m, sid, lo, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (Some(sid), None, Some(hi)) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.source_id = ?2 AND e.start_at <= ?3
                 ORDER BY e.start_at ASC LIMIT ?4",
            )?;
            for row in s.query_map(params![m, sid, hi, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (Some(sid), None, None) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.source_id = ?2
                 ORDER BY e.start_at ASC LIMIT ?3",
            )?;
            for row in s.query_map(params![m, sid, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (None, Some(lo), Some(hi)) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.start_at >= ?2 AND e.start_at <= ?3
                 ORDER BY e.start_at ASC LIMIT ?4",
            )?;
            for row in s.query_map(params![m, lo, hi, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (None, Some(lo), None) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.start_at >= ?2
                 ORDER BY e.start_at ASC LIMIT ?3",
            )?;
            for row in s.query_map(params![m, lo, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (None, None, Some(hi)) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1 AND e.start_at <= ?2
                 ORDER BY e.start_at ASC LIMIT ?3",
            )?;
            for row in s.query_map(params![m, hi, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
        (None, None, None) => {
            let mut s = conn.prepare(
                "SELECT e.id FROM calendar_events e
                 JOIN calendar_events_fts ON calendar_events_fts.rowid = e.id
                 WHERE calendar_events_fts MATCH ?1
                 ORDER BY e.start_at ASC LIMIT ?2",
            )?;
            for row in s.query_map(params![m, lim], |r| r.get::<_, i64>(0))? {
                ids.push(row?);
            }
        }
    }
    Ok(ids)
}

pub fn fetch_event_json_by_uid(
    conn: &Connection,
    source_id: &str,
    uid: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT json_object(
            'uid', uid, 'sourceId', source_id, 'sourceKind', source_kind, 'calendarId', calendar_id,
            'summary', summary, 'description', description, 'location', location,
            'startAt', start_at, 'endAt', end_at, 'allDay', all_day, 'timezone', timezone,
            'status', status, 'rrule', rrule, 'color', color
         ) FROM calendar_events WHERE source_id = ?1 AND uid = ?2",
        params![source_id, uid],
        |r| r.get(0),
    )
    .optional()
}

pub fn fetch_event_json_by_rowid(
    conn: &Connection,
    rowid: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT json_object(
            'id', id, 'uid', uid, 'sourceId', source_id, 'sourceKind', source_kind, 'calendarId', calendar_id,
            'summary', summary, 'description', description, 'location', location,
            'startAt', start_at, 'endAt', end_at, 'allDay', all_day, 'timezone', timezone,
            'status', status, 'rrule', rrule, 'color', color
         ) FROM calendar_events WHERE id = ?1",
        [rowid],
        |r| r.get(0),
    )
    .optional()
}

pub fn list_events_in_range(
    conn: &Connection,
    source_id: Option<&str>,
    start_min: i64,
    start_max: i64,
    limit: usize,
) -> rusqlite::Result<Vec<String>> {
    let lim = limit.clamp(1, 500) as i64;
    let mut out = Vec::new();
    if let Some(sid) = source_id {
        let mut s = conn.prepare(
            "SELECT json_object(
                'uid', uid, 'sourceId', source_id, 'sourceKind', source_kind, 'calendarId', calendar_id,
            'summary', summary, 'location', location,
            'startAt', start_at, 'endAt', end_at, 'allDay', all_day, 'color', color
         ) FROM calendar_events WHERE source_id = ?1 AND start_at >= ?2 AND start_at < ?3
             ORDER BY start_at ASC LIMIT ?4",
        )?;
        for row in s.query_map(params![sid, start_min, start_max, lim], |r| {
            r.get::<_, String>(0)
        })? {
            out.push(row?);
        }
    } else {
        let mut s = conn.prepare(
            "SELECT json_object(
                'uid', uid, 'sourceId', source_id, 'sourceKind', source_kind, 'calendarId', calendar_id,
            'summary', summary, 'location', location,
            'startAt', start_at, 'endAt', end_at, 'allDay', all_day, 'color', color
         ) FROM calendar_events WHERE start_at >= ?1 AND start_at < ?2
             ORDER BY start_at ASC LIMIT ?3",
        )?;
        for row in s.query_map(params![start_min, start_max, lim], |r| {
            r.get::<_, String>(0)
        })? {
            out.push(row?);
        }
    }
    Ok(out)
}

/// Events overlapping inclusive from/to dates (YYYY-MM-DD), UTC calendar-day bounds.
pub fn list_events_overlapping(
    conn: &Connection,
    source_id: Option<&str>,
    calendar_ids: &[String],
    range_start: i64,
    range_end: i64,
    limit: usize,
) -> rusqlite::Result<Vec<String>> {
    let lim = limit.clamp(1, 2000) as i64;
    let mut out = Vec::new();

    let mut query = "SELECT json_object(
                'uid', uid, 'sourceId', source_id, 'sourceKind', source_kind, 'calendarId', calendar_id,
                'summary', summary, 'description', description, 'location', location,
                'startAt', start_at, 'endAt', end_at, 'allDay', all_day,
                'organizerEmail', organizer_email,
                'attendeesJson', attendees_json,
                'color', color
             ) FROM calendar_events
             WHERE start_at < ?2 AND end_at > ?1".to_string();

    let mut params: Vec<Box<dyn rusqlite::ToSql>> =
        vec![Box::new(range_start), Box::new(range_end)];

    if let Some(sid) = source_id {
        query.push_str(" AND source_id = ?3");
        params.push(Box::new(sid.to_string()));
    }

    if !calendar_ids.is_empty() {
        let p_start = params.len() + 1;
        let placeholders: Vec<String> = (0..calendar_ids.len())
            .map(|i| format!("?{}", p_start + i))
            .collect();
        query.push_str(&format!(" AND calendar_id IN ({})", placeholders.join(",")));
        for id in calendar_ids {
            params.push(Box::new(id.clone()));
        }
    }

    query.push_str(" ORDER BY start_at ASC LIMIT ");
    query.push_str(&format!("?{}", params.len() + 1));
    params.push(Box::new(lim));

    let mut s = conn.prepare(&query)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    for row in s.query_map(rusqlite::params_from_iter(param_refs), |r| {
        r.get::<_, String>(0)
    })? {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::model::CalendarEventRow;
    use crate::db::apply_schema;

    fn mem_with_schema() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        apply_schema(&conn).expect("schema");
        conn
    }

    fn sample_row(
        source_id: &str,
        uid: &str,
        summary: &str,
        start: i64,
        end: i64,
    ) -> CalendarEventRow {
        CalendarEventRow {
            source_id: source_id.into(),
            source_kind: "icsFile".into(),
            calendar_id: "cal".into(),
            uid: uid.into(),
            summary: Some(summary.into()),
            description: None,
            location: None,
            start_at: start,
            end_at: end,
            all_day: false,
            timezone: None,
            status: None,
            rrule: None,
            recurrence_json: None,
            attendees_json: None,
            organizer_email: None,
            organizer_name: None,
            updated_at: None,
            synced_at: Some(1),
            color: None,
            raw_json: None,
        }
    }

    #[test]
    fn upsert_list_range_and_fts() {
        let conn = mem_with_schema();
        let a = sample_row("s1", "u1", "standup daily", 1000, 1100);
        let b = sample_row("s1", "u2", "other", 2000, 2100);
        upsert_event(&conn, &a).unwrap();
        upsert_event(&conn, &b).unwrap();

        let rows = list_events_in_range(&conn, Some("s1"), 900, 1500, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].contains("standup"));

        let ids = search_events_fts(&conn, "standup", Some("s1"), None, None, 10).unwrap();
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn list_events_overlapping_with_calendar_filter() {
        let conn = mem_with_schema();
        let mut a = sample_row("s1", "u1", "Cal A Event", 1000, 1100);
        a.calendar_id = "cal_a".into();
        let mut b = sample_row("s1", "u2", "Cal B Event", 1000, 1100);
        b.calendar_id = "cal_b".into();

        upsert_event(&conn, &a).unwrap();
        upsert_event(&conn, &b).unwrap();

        // No filter: returns both
        let rows = list_events_overlapping(&conn, Some("s1"), &[], 900, 1200, 10).unwrap();
        assert_eq!(rows.len(), 2);

        // Filter for cal_a: returns only A
        let rows =
            list_events_overlapping(&conn, Some("s1"), &["cal_a".into()], 900, 1200, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].contains("Cal A Event"));

        // Filter for cal_b: returns only B
        let rows =
            list_events_overlapping(&conn, Some("s1"), &["cal_b".into()], 900, 1200, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].contains("Cal B Event"));
    }
}
