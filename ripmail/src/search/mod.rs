//! FTS5 search (mirrors `src/search/index.ts`).

mod agent_hints;
mod contact_rank;
mod edit_distance;
mod engine;
mod escape;
mod filter;
mod infer_name;
mod json_format;
mod nicknames;
mod noreply;
mod normalize;
mod phonetics;
mod query_parse;
mod rule_membership;
mod signature;
mod types;
pub mod who;
mod who_infer;
mod whoami;

pub use contact_rank::{
    compute_contact_rank_who, contact_rank_simple, sort_rows_by_sender_contact_rank,
};
pub use edit_distance::fuzzy_name_token_match;
pub use engine::{
    effective_search_options, effective_search_options_for_rule_query, search_with_meta,
};
pub use escape::{convert_to_or_query, escape_fts5_query};
pub use infer_name::infer_name_from_address;
pub use json_format::{
    resolve_search_json_format, search_result_to_slim_json_row, SearchJsonFormat,
    SearchResultFormatPreference, SEARCH_AUTO_SLIM_THRESHOLD,
};
pub use nicknames::canonical_first_name;
pub use noreply::is_noreply;
pub use normalize::normalize_address;
pub use phonetics::name_matches_phonetically;
pub use query_parse::{normalize_search_date_spec, parse_search_query, ParsedSearchQuery};
pub use rule_membership::{assign_pending_matching_rule_query, count_messages_matching_rule_query};
pub use signature::{extract_signature_data, parse_signature_block, ExtractedSignature};
pub use types::{SearchOptions, SearchResult, SearchResultSet, SearchTimings};
pub use who::{who, WhoOptions, WhoPerson, WhoResult};
pub use who_infer::{infer_placeholder_owner_identities, is_placeholder_mailbox_email};
pub use whoami::{whoami, WhoamiInferred, WhoamiMailbox, WhoamiResult};
