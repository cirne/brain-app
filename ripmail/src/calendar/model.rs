//! Normalized calendar row for SQLite ([OPP-053](https://github.com/cirne/zmail)).

#[derive(Debug, Clone, Default)]
pub struct CalendarEventRow {
    pub source_id: String,
    pub source_kind: String,
    pub calendar_id: String,
    /// Local calendar list title when known (e.g. Apple `Calendar.title`, optional for ICS).
    pub calendar_name: Option<String>,
    pub uid: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_at: i64,
    pub end_at: i64,
    pub all_day: bool,
    pub timezone: Option<String>,
    pub status: Option<String>,
    pub rrule: Option<String>,
    pub recurrence_json: Option<String>,
    pub attendees_json: Option<String>,
    pub organizer_email: Option<String>,
    pub organizer_name: Option<String>,
    pub updated_at: Option<i64>,
    pub synced_at: Option<i64>,
    pub color: Option<String>,
    pub raw_json: Option<String>,
}
