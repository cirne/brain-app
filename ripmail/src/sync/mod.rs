//! IMAP sync: parsing, windows, maildir, locks, and `run_sync` / IMAP transport.

pub mod background_spawn;
pub mod error;
pub mod fetch_timeout;
pub mod imap_date;
pub mod maildir;
pub mod onboarding;
pub mod parse_message;
pub mod parse_since;
pub mod process_lock;
pub mod retry;
pub mod run;
pub mod sync_log;
pub mod transport;
pub mod windows;

pub use background_spawn::{run_refresh_foreground_subprocess, spawn_sync_background_detached};
pub use error::RunSyncError;
pub use maildir::{write_maildir_message, MaildirWrite};
pub use onboarding::{
    first_backfill_completed, mailbox_needs_first_backfill, mark_first_backfill_completed,
};
pub use parse_message::{
    addresses_from_mailbox_entries, parse_index_message, parse_raw_message,
    parse_raw_message_with_options, parse_read_full, MailboxEntry, ParseMessageOptions,
    ParsedAttachment, ParsedMessage, ReadForCli,
};
pub use parse_since::parse_since_to_date;
pub use process_lock::{
    acquire_lock, is_process_alive, is_sync_lock_held, millis_since_sync_lock_started_at,
    release_lock, LockResult, SyncLockRow,
};
pub use run::{
    resolve_sync_folder_for_host, resolve_sync_mailbox, resolve_sync_since_ymd, run_sync,
    run_sync_with_parallel_imap_connect, should_early_exit_forward, SyncDirection,
    SyncMailboxSummary, SyncOptions, SyncResult,
};
pub use sync_log::{sync_log_path, SyncFileLogger};
pub use transport::{
    connect_imap_for_resolved_mailbox, connect_imap_session, connect_imap_session_with_auth,
    FakeImapTransport, FetchedMessage, ImapAuth, ImapStatusData, RealImapTransport,
    SyncImapTransport,
};
pub use windows::{
    filter_uids_after, forward_uid_range, last_uid_for_folder, oldest_message_date_for_folder,
    same_calendar_day,
};
