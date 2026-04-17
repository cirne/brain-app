//! ripmail library — Rust CLI implementation (workspace root).

pub mod agent_skill_install;
pub mod applemail;
pub mod ask;
pub mod ask_stub;
pub mod attachments;
pub mod brain_app_layout;
pub mod config;
pub mod db;
pub mod draft;
mod draft_args;
pub mod ids;
pub mod inbox;
pub mod inbox_window;
pub mod layout_migrate;
pub mod mail_category;
pub mod mail_read;
pub mod mailbox;
pub mod mime_decode;
pub mod oauth;
pub mod rebuild_index;

pub use oauth::{
    google_oauth_credentials_present, google_oauth_token_path, resolve_oauth_relay_base,
    DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID, DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET,
    DEFAULT_PUBLIC_OAUTH_RELAY_BASE,
};
pub mod refresh;
pub mod rules;
pub mod search;
pub mod send;
pub mod setup;
pub mod sources;
pub mod status;
pub mod sync;
pub mod thread_view;
pub mod wizard;

pub use agent_skill_install::{
    install_skill_from_embed, install_skill_from_embed_with_options, install_skill_from_workspace,
    InstallSkillFromEmbedOptions,
};
pub use applemail::{run_applemail_sync, validate_envelope_index_for_setup};
pub use ask::{run_ask, RunAskError, RunAskOptions};
pub use ask_stub::{
    ask_rejects_old_explicit_year, ask_rejects_stale_date_range, draft_rewrite_stub,
};
pub use attachments::{
    extract_and_cache, extract_attachment, list_attachments_for_message, local_file_read_outcome,
    local_file_skipped_too_large, read_attachment_bytes, read_attachment_text, read_stored_file,
    AttachmentListRow, LocalFileReadJson, LocalFileReadOutcome, MAX_LOCAL_FILE_BYTES,
};
pub use config::{
    build_llm_client, check_ripmail_home_access, config_for_outbound_send,
    derive_mailbox_id_from_email, draft_compose_identity_for_mailbox, load_all_mailboxes,
    load_config, load_config_json, mailbox_config_by_id, mailbox_ids_for_default_search,
    merge_mailbox_identity, migrate_legacy_zmail_home_dir_if_needed, read_ripmail_env_file,
    resolve_config_target_mailbox_id, resolve_llm, resolve_llm_with_env, resolve_mailbox_spec,
    resolve_openai_api_key, resolve_smtp_settings, resolved_ripmail_home_from_env,
    write_config_json, Config, ConfigJson, DraftComposeIdentity, IdentityPatch, LlmJson,
    LlmProvider, LoadConfigOptions, MailboxConfigJson, MailboxIdentityJson, MailboxImapAuthKind,
    ResolvedLlm, ResolvedMailbox, ResolvedSmtp, SourceKind,
};
pub use db::message_persist::{fts_match_count, persist_attachments_from_parsed, persist_message};
pub use db::{
    apply_schema, journal_mode, list_user_tables, open_file, open_memory, purge_mailbox_from_index,
    DbError, SCHEMA_VERSION,
};
pub use ids::{
    attachment_message_id_lookup_keys, message_id_for_json_output, message_id_lookup_keys,
    normalize_message_id, resolve_message_id, resolve_message_id_and_raw_path,
    resolve_message_id_thread_and_raw_path, resolve_thread_id,
};
pub use inbox::{
    archive_messages_locally, count_indexed_messages_simple_window,
    count_unarchived_messages_by_mailbox, inbox_candidate_prefetch_limit, preview_rule_impact,
    record_inbox_scan, run_inbox_scan, run_post_rebuild_inbox_bootstrap,
    DeterministicInboxClassifier, InboxBatchClassifier, InboxCandidate, InboxNotablePick,
    InboxOwnerContext, InboxSurfaceMode, MockInboxClassifier, PostRebuildBootstrapSummary,
    RuleImpactPreview, RunInboxScanError, RunInboxScanOptions, RunInboxScanResult,
    SupersessionByRule,
};
pub use inbox_window::parse_inbox_window_to_iso_cutoff;
pub use layout_migrate::{
    infer_maildir_root_for_db_path, migrate_deferred_legacy_data_if_needed,
    migrate_deferred_legacy_data_if_needed_for_db_path, migrate_legacy_layout_to_multi_inbox,
    needs_deferred_legacy_data_migration, needs_legacy_layout_migration, ripmail_home_from_db_path,
};
pub use mail_category::{
    default_category_filter_sql, is_default_excluded_category, label_to_category,
    parse_category_list, DEFAULT_EXCLUDED_CATEGORIES,
};
pub use mail_read::{
    format_read_message_text, read_message_bytes, read_message_bytes_with_thread, resolve_raw_path,
    ReadMessageJson,
};
pub use mailbox::{provider_archive_message, ProviderArchiveOutcome};
pub use mime_decode::decode_rfc2047_header_line;
pub use rebuild_index::{rebuild_from_maildir, rebuild_from_maildir_sequential};
pub use refresh::{
    build_check_json, build_refresh_json_value, build_refresh_json_value_with_extras,
    build_review_json, inbox_json_hints, load_refresh_new_mail, print_check_text,
    print_refresh_text, print_review_text, InboxDispositionCounts, RefreshPreviewRow,
};
pub use rules::{
    add_rule_from_json, add_search_rule, edit_rule, effective_rules_fingerprint_for_mailbox,
    ensure_default_rules_file, inbox_rules_fingerprint_for_scope, load_effective_rules_for_mailbox,
    load_rules_file, load_rules_file_from_path, mailbox_rules_path, move_rule, parse_rule_action,
    propose_rule_from_feedback, remove_rule, reset_rules_to_bundled_defaults,
    rules_directory_for_mailbox, rules_file_needs_default_replacement, rules_fingerprint,
    rules_path, validate_rules_file, validate_rules_file_with_db_sample, ContextEntry,
    ProposedRule, RuleActionKind, RuleFeedbackProposal, RulesError, RulesFile, UserRule,
    RULES_FILE_FORMAT_VERSION,
};
pub use search::{
    assign_pending_matching_rule_query, canonical_first_name, contact_rank_simple,
    convert_to_or_query, count_messages_matching_rule_query, effective_search_options,
    effective_search_options_for_rule_query, escape_fts5_query, extract_signature_data,
    fuzzy_name_token_match, infer_name_from_address, infer_placeholder_owner_identities,
    is_noreply, is_placeholder_mailbox_email, name_matches_phonetically, normalize_address,
    normalize_search_date_spec, parse_search_query, parse_signature_block,
    resolve_search_json_format, search_result_to_slim_json_row, search_with_meta,
    sort_rows_by_sender_contact_rank, who, whoami, ExtractedSignature, ParsedSearchQuery,
    SearchJsonFormat, SearchOptions, SearchResult, SearchResultFormatPreference, SearchResultSet,
    SearchTimings, WhoOptions, WhoPerson, WhoResult, WhoamiInferred, WhoamiMailbox, WhoamiResult,
    SEARCH_AUTO_SLIM_THRESHOLD,
};
pub use send::{
    apply_recipient_header_ops, extract_threading_headers, filter_recipients_send_test,
    list_drafts, load_threading_from_source_message, plan_send, read_draft,
    resolve_send_config_for_draft, resolve_smtp_for_imap_host, send_draft_by_id,
    send_simple_message, smtp_credentials_ready, smtp_credentials_unavailable_reason,
    split_address_list, verify_smtp_credentials, verify_smtp_for_config, write_draft, DraftFile,
    DraftMeta, RecipientHeaderOps, SendPlan, SendResult, SendSimpleFields, SendTestMode,
};
pub use setup::{
    clean_ripmail_home, collect_stats, derive_imap_settings, load_existing_env_secrets,
    load_existing_wizard_config, load_imap_password_for_mailbox_id,
    load_mailbox_configs_for_wizard, mask_secret, merge_root_google_oauth_client_if_missing,
    merge_root_oauth_relay_base_if_missing, merge_root_openai_key, parse_dotenv_secrets,
    remove_mailbox_from_config, replace_mailbox_entry, resolve_setup_email, resolve_setup_password,
    ripmail_clean_preview, ripmail_home_has_entries, update_mailbox_identity,
    update_mailbox_management, update_sync_default_since, upsert_mailbox_applemail,
    upsert_mailbox_setup, validate_imap_credentials, validate_openai_key,
    wizard_is_first_mailbox_setup, write_applemail_setup, write_google_oauth_setup,
    write_google_oauth_setup_hosted, write_ripmail_config_and_env, write_setup, DerivedImap,
    ExistingEnvSecrets, ExistingWizardConfig, SetupArgs, StatsJson, WriteZmailParams,
};
pub use sources::run_local_dir_sync;
pub use status::{
    format_time_ago, get_imap_server_status, get_status, mailbox_status_lines, print_status_text,
    status_initial_sync_hang_suspected, status_stale_lock_running, FreshnessAgoJson,
    ImapServerComparison, MailboxStatusLine, StatusData,
};
pub use sync::{
    acquire_lock, connect_imap_for_resolved_mailbox, connect_imap_session,
    connect_imap_session_with_auth, filter_uids_after, first_backfill_completed, forward_uid_range,
    is_process_alive, is_sync_lock_held, mailbox_needs_first_backfill,
    mark_first_backfill_completed, millis_since_sync_lock_started_at,
    oldest_message_date_for_folder, parse_index_message, parse_raw_message,
    parse_raw_message_with_options, parse_read_full, parse_since_to_date, release_lock,
    resolve_sync_folder_for_host, resolve_sync_mailbox, resolve_sync_since_ymd,
    run_refresh_foreground_subprocess, run_sync, run_sync_with_parallel_imap_connect,
    same_calendar_day, should_early_exit_forward, spawn_sync_background_detached, sync_log_path,
    write_maildir_message, FakeImapTransport, FetchedMessage, ImapAuth, ImapStatusData, LockResult,
    MailboxEntry, MaildirWrite, ParseMessageOptions, ParsedAttachment, ParsedMessage, ReadForCli,
    RealImapTransport, RunSyncError, SyncDirection, SyncFileLogger, SyncImapTransport, SyncLockRow,
    SyncMailboxSummary, SyncOptions, SyncResult,
};
pub use thread_view::{list_thread_messages, ThreadMessageRow};
pub use wizard::{run_wizard, WizardOptions};
