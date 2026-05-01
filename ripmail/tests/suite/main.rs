//! Single integration-test binary for ripmail. Cargo links `libripmail` once here instead of
//! once per top-level `tests/*.rs` crate — cuts compile/link time on multi-core machines.

mod aaa_use_nextest;
mod ask_inbox_guards;
mod attachments_extract;
mod backfill_cli;
mod calendar_cli;
mod calendar_sync_calendar_ids_regression;
mod clean_cli;
mod cli_invalid_subcommand_help;
mod config_schema_status;
mod draft_lazy_db;
mod gmail_api_live_send;
mod google_drive_tests;
mod inbox_scan;
mod local_dir_sync_search;
mod local_dir_xlsx_sync_search;
mod lock_clear_cli;
mod oauth_mailbox_draft_send_cli;
mod read_file_xlsx_cli;
mod read_local_file_json_cli;
mod rules_cli;
mod search_fts;
mod send_drafts;
mod setup_cli;
mod setup_oauth_cli;
mod setup_read_rebuild;
mod setup_upsert;
mod skill_install_cli;
mod smtp_qp_paragraph_merge_fixture;
mod sync_parse_maildir;
mod sync_run_fake_imap;
mod who_identity;
mod wizard_cli;
