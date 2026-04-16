//! Apple Mail localhost mailbox — read Envelope Index + `.emlx` ([`OPP-050`](../../docs/opportunities/OPP-050-applemail-localhost-mailbox.md)).

pub mod emlx;
pub mod envelope_index;
pub mod paths;
pub mod skip;
pub mod sync;

pub use emlx::{extract_mime_from_emlx_bytes, read_mail_file_bytes, EmlxError};
pub use envelope_index::{
    apple_mail_time_to_ymd, cocoa_seconds_to_iso8601, default_mail_library_root,
    discover_mail_library_roots, envelope_candidate_received_date_ymd, envelope_index_path,
    envelope_received_date_ymd, list_candidates_since_keyset, message_row_by_rowid,
    messages_table_row_count, open_envelope_readonly, sample_messages, sample_messages_page,
    schema_dump, validate_envelope_index_for_setup, EnvelopeCandidate, EnvelopeMessageRow,
};
pub use paths::{
    discover_store_root, emlx_shard_path, file_url_to_path, find_emlx_under_mbox,
    index_messages_tree, resolve_emlx_deterministic_then_scan, resolve_emlx_for_row,
    resolve_emlx_for_row_with_diag, resolve_emlx_path, resolve_emlx_path_with_diag,
    resolve_mailbox_mbox_path, ApplemailEmlxCache, PathResolveDiag, PathResolveMethod,
};
pub use sync::run_applemail_sync;
