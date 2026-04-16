//! Shared `clap` argument groups for `ripmail draft` subcommands.

use clap::Args;
use std::path::PathBuf;

/// Positional or flag message id (reply / forward).
#[derive(Args, Debug, Clone, Default)]
pub struct DraftIndexedMessageId {
    /// Source message (RFC Message-ID); positional or `--message-id` (same as `ripmail read`)
    #[arg(value_name = "MESSAGE_ID")]
    pub message_id_pos: Option<String>,
    #[arg(long = "message-id")]
    pub message_id_flag: Option<String>,
}

/// Literal `--body` / `--body-file` for reply and forward when not using `--instruction`.
#[derive(Args, Debug, Clone, Default)]
pub struct DraftReplyForwardLiteralBody {
    #[arg(
        long,
        conflicts_with = "instruction",
        help = "Literal message body (reply) or preamble (forward) when not using --instruction."
    )]
    pub body: Option<String>,
    #[arg(
        long,
        conflicts_with = "instruction",
        help = "Same as --body from a file (fallback for verbatim or large text)."
    )]
    pub body_file: Option<PathBuf>,
}
