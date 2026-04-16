use clap::{Args, Parser, Subcommand};

use crate::cli::identity_args::IdentityArgs;

/// Shown for `ripmail --version` (`-V` stays a single line from `version =`).
const CLI_LONG_VERSION: &str = concat!(
    env!("CARGO_PKG_VERSION"),
    "\n\n",
    "Upgrade / reinstall (prebuilt binary):\n",
    "  curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash\n",
    "  curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | INSTALL_PREFIX=~/bin bash\n",
    "  curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash -s -- --nightly\n",
    "\n",
    "If you installed via Homebrew, npm, or cargo, upgrade with that tool instead.\n",
);

#[derive(Parser)]
#[command(name = "ripmail")]
#[command(about = "ripmail: Agent-first email")]
#[command(version = env!("CARGO_PKG_VERSION"), long_version = CLI_LONG_VERSION)]
#[command(
    subcommand_required = false,
    help_template = "\
{before-help}{about-with-newline}\
{usage-heading} {usage}\
{after-help}\
{options}\
",
    after_help = "Upgrade / reinstall: ripmail --version (long text) or ripmail --help.\nRun ripmail --help for the full command list by workflow.\n",
    after_long_help = include_str!("root_help.txt")
)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Option<Commands>,
}

/// Appended to `ripmail setup --help` (long help only); also shown when `setup` runs without credentials.
pub(crate) const SETUP_CMD_AFTER_LONG_HELP: &str = "\
`ripmail setup` is non-interactive: pass credentials via flags or environment variables (no prompts).

Required:
  --email <addr>           Account address (or env RIPMAIL_EMAIL)
  Either:
    --password <secret>    IMAP password, e.g. Gmail app password (or RIPMAIL_IMAP_PASSWORD)
    --google-oauth         Gmail: browser OAuth instead of app password (tokens under ~/.ripmail/<id>/)
    --apple-mail           macOS: index local Apple Mail (no IMAP password; see --apple-mail-path)

Recommended:
  --openai-key <key>       Or RIPMAIL_OPENAI_API_KEY / OPENAI_API_KEY in the environment

Examples:
  ripmail setup --email you@gmail.com --password 'app-password' --openai-key 'sk-...'
  ripmail setup --email you@gmail.com --google-oauth --openai-key 'sk-...'
  ripmail setup --apple-mail --no-validate --no-skill
  RIPMAIL_EMAIL=you@gmail.com RIPMAIL_IMAP_PASSWORD='...' RIPMAIL_OPENAI_API_KEY='sk-...' ripmail setup

Optional:
  --id <mailbox-id>        Stable id (default: derived from --email)
  --apple-mail-path <dir>  With --apple-mail: Mail library root (default: latest ~/Library/Mail/V*)
  --imap-host, --imap-port Non-Gmail IMAP
  --no-validate            Skip IMAP, SMTP, and OpenAI checks
  --no-skill               Do not install the `/ripmail` agent skill (default: install after successful setup)
  Identity (optional):    --preferred-name, --full-name, --signature, --signature-id (same as `ripmail config`)

Post-install settings (no credentials): `ripmail config` — identity, mailbox management, etc.

Interactive setup (TTY): ripmail wizard
";

/// Appended to `ripmail config --help` (long help only).
pub(crate) const CONFIG_CMD_AFTER_LONG_HELP: &str = "\
`ripmail config` updates an existing `config.json` (no IMAP passwords, no OAuth).

Requires mailboxes already configured (`ripmail setup` or `ripmail wizard`).

Per-mailbox targeting (when multiple mailboxes exist):
  --id <mailbox-id>        Mailbox id from config.json
  --email <addr>           Match mailbox by email address

When only one mailbox exists, `--id` / `--email` may be omitted.

Identity (optional; merge into existing):
  --preferred-name, --full-name, --signature, --signature-id (or env RIPMAIL_PREFERRED_NAME, etc.)

Global:
  --mailbox-management on|off   IMAP archive propagation (`mailboxManagement.enabled`)

Examples:
  ripmail config --preferred-name \"Jane\" --signature \"Thanks, Jane\"
  ripmail config --id work --mailbox-management on
";

/// Appended to `ripmail clean --help` (long help only).
pub(crate) const CLEAN_CMD_AFTER_LONG_HELP: &str = "\
Deletes every top-level file and directory under RIPMAIL_HOME (default ~/.ripmail): config, SQLite index, secrets, per-mailbox dirs, logs, rules — same scope as `ripmail wizard --clean`.

Does not delete mail on your IMAP server or in Apple Mail.

Without `--yes`, prints what would be removed and exits successfully. With `--yes`, performs the deletion (cannot be undone).

Examples:
  ripmail clean
  ripmail clean --yes
";

fn parse_mailbox_management_on_off(s: &str) -> Result<bool, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "on" | "true" | "1" | "yes" => Ok(true),
        "off" | "false" | "0" | "no" => Ok(false),
        _ => Err(format!("expected on or off, got {s:?}")),
    }
}

#[derive(Subcommand)]
pub(crate) enum Commands {
    /// Write ~/.ripmail config (non-interactive)
    #[command(after_long_help = SETUP_CMD_AFTER_LONG_HELP)]
    Setup {
        #[arg(long)]
        email: Option<String>,
        #[arg(long)]
        password: Option<String>,
        /// Google OAuth (browser) instead of app password — requires OAuth client env (see OPP-042).
        #[arg(long)]
        google_oauth: bool,
        /// macOS: add `mailboxType: applemail` (local Envelope Index; no IMAP password or OAuth).
        #[arg(
            long = "apple-mail",
            conflicts_with_all = ["password", "google_oauth", "imap_host", "imap_port"]
        )]
        apple_mail: bool,
        /// With `--apple-mail`: Apple Mail library root (`~/Library/Mail/V10`). Default: latest `V*`.
        #[arg(long = "apple-mail-path", value_name = "PATH", requires = "apple_mail")]
        apple_mail_path: Option<String>,
        #[arg(long)]
        openai_key: Option<String>,
        /// Stable mailbox id (default: slug from `--email`)
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        imap_host: Option<String>,
        #[arg(long)]
        imap_port: Option<u16>,
        #[arg(long)]
        no_validate: bool,
        /// Skip installing the embedded `/ripmail` agent skill after successful setup (default: install).
        #[arg(long)]
        no_skill: bool,
        #[command(flatten)]
        identity: IdentityArgs,
    },
    /// Update non-secret settings in ~/.ripmail (identity, mailbox management)
    #[command(after_long_help = CONFIG_CMD_AFTER_LONG_HELP)]
    Config {
        #[command(flatten)]
        identity: IdentityArgs,
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        email: Option<String>,
        #[arg(long, value_name = "on|off", value_parser = parse_mailbox_management_on_off)]
        mailbox_management: Option<bool>,
    },
    /// Install or refresh the publishable `/ripmail` agent skill (Claude Code, OpenClaw when configured)
    Skill {
        #[command(subcommand)]
        sub: SkillCmd,
    },
    /// Interactive TUI setup (prompts; use `ripmail setup` for agents)
    Wizard {
        #[arg(long)]
        no_validate: bool,
        #[arg(long)]
        clean: bool,
        #[arg(long)]
        yes: bool,
    },
    /// Remove all ripmail data under RIPMAIL_HOME (use `--yes` to delete; default is preview only)
    #[command(after_long_help = CLEAN_CMD_AFTER_LONG_HELP)]
    Clean {
        /// Confirm deletion (required to remove files; no prompt)
        #[arg(long)]
        yes: bool,
    },
    /// Fetch mail from IMAP: forward sync by default; new mailboxes get one automatic backfill
    /// using `sync.defaultSince` on plain `refresh`. Use `--since` for explicit history windows.
    #[command(name = "refresh")]
    Refresh {
        /// Positional duration (e.g. `7d`, `180d`, `1y`) — same as `--since`
        duration: Option<String>,
        /// Rolling window — overrides `sync.defaultSince` when set
        #[arg(long, short = 's')]
        since: Option<String>,
        /// Same as `--since` with the value from `sync.defaultSince` in config (explicit backfill)
        #[arg(long, alias = "init", conflicts_with_all = ["since", "duration"])]
        backfill: bool,
        /// Sync only this mailbox (email or `mailbox_id` from config); default = all configured
        #[arg(long)]
        mailbox: Option<String>,
        #[arg(long, alias = "fg")]
        foreground: bool,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        text: bool,
        /// Extra DEBUG lines in the sync log (and stderr progress mirrored to the log when set)
        #[arg(long, short = 'v')]
        verbose: bool,
    },
    /// Sync and search readiness
    Status {
        #[arg(long)]
        json: bool,
        #[arg(long, alias = "server")]
        imap: bool,
    },
    /// Full-text search (JSON by default)
    Search {
        /// Free-text query terms (optional when --from/--after/--since/--before/--category filters are provided)
        query: Option<String>,
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        from: Option<String>,
        /// Only messages on or after this date (ISO `YYYY-MM-DD` or rolling spec e.g. `7d`, `1y`)
        #[arg(long)]
        after: Option<String>,
        /// Same lower bound as `--after` (rolling or ISO)
        #[arg(long, short = 's', conflicts_with = "after")]
        since: Option<String>,
        /// Only messages on or before this date (ISO or rolling spec)
        #[arg(long)]
        before: Option<String>,
        #[arg(long)]
        mailbox: Option<String>,
        #[arg(long)]
        include_all: bool,
        #[arg(long)]
        category: Option<String>,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        #[arg(long, value_parser = ["auto", "full", "slim"])]
        result_format: Option<String>,
        #[arg(long)]
        timings: bool,
    },
    /// Top contacts / people search
    Who {
        query: Option<String>,
        #[arg(long, default_value_t = 50)]
        limit: usize,
        #[arg(long)]
        mailbox: Option<String>,
        #[arg(long)]
        include_noreply: bool,
        #[arg(long)]
        text: bool,
    },
    /// Configured identity (name, addresses) plus optional inference from indexed mail
    #[command(name = "whoami")]
    Whoami {
        /// Limit to one mailbox (email or mailbox id from config)
        #[arg(long)]
        mailbox: Option<String>,
        #[arg(long)]
        text: bool,
    },
    /// Read one or more messages (raw .eml or headers + body); multiple ids = batch (JSON array, text with separators)
    Read {
        #[arg(value_name = "MESSAGE_ID", num_args = 1..)]
        message_ids: Vec<String>,
        #[arg(long)]
        raw: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
    },
    /// List messages in a thread
    Thread {
        thread_id: String,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
    },
    /// List or read message attachments (extracted text / CSV)
    #[command(name = "attachment")]
    Attachment {
        #[command(subcommand)]
        sub: AttachmentCmd,
    },
    /// Answer a question about your email (requires RIPMAIL_OPENAI_API_KEY)
    Ask {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        question: Vec<String>,
        #[arg(long, short = 'v')]
        verbose: bool,
    },
    /// Inbox triage over the local index (deterministic rules; no IMAP sync; run `ripmail refresh` when recency matters)
    Inbox(InboxArgs),
    /// Archive messages locally (`is_archived`); optional IMAP when mailboxManagement is enabled
    Archive {
        /// One or more RFC Message-IDs
        #[arg(required = true)]
        message_ids: Vec<String>,
        #[arg(long)]
        undo: bool,
    },
    /// Send mail via SMTP (same IMAP credentials; optional `RIPMAIL_SEND_TEST=1` guard)
    Send {
        draft_id: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        cc: Option<String>,
        #[arg(long)]
        bcc: Option<String>,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        text: bool,
    },
    /// Local drafts under data/drafts/ (list, view, new, reply, forward, edit, rewrite)
    #[command(after_long_help = DRAFT_CMD_AFTER_LONG_HELP)]
    Draft {
        #[command(subcommand)]
        sub: ripmail::draft::DraftCmd,
    },
    /// Manage inbox rules in ~/.ripmail/rules.json
    #[command(after_long_help = RULES_CMD_AFTER_LONG_HELP)]
    Rules {
        /// Target `~/.ripmail/<id>/rules.json` overlay (email or id); omit for global `rules.json`
        #[arg(long)]
        mailbox: Option<String>,
        #[command(subcommand)]
        sub: RulesCmd,
    },
    /// Database counts
    Stats {
        #[arg(long)]
        json: bool,
    },
    /// Rebuild SQLite index from maildir tree
    #[command(name = "rebuild-index")]
    RebuildIndex,
}

#[derive(Subcommand)]
pub(crate) enum SkillCmd {
    /// Copy the embedded `/ripmail` skill to Claude Code and OpenClaw (when configured)
    Install,
}

#[derive(Subcommand)]
pub(crate) enum AttachmentCmd {
    /// List attachments for a message (JSON unless --text)
    List {
        #[arg(value_name = "MESSAGE_ID")]
        message_id_pos: Option<String>,
        #[arg(long = "message-id")]
        message_id_flag: Option<String>,
        #[arg(long)]
        text: bool,
    },
    /// Print extracted text (or raw bytes with --raw)
    Read {
        message_id: String,
        index_or_name: String,
        #[arg(long)]
        raw: bool,
        #[arg(long)]
        no_cache: bool,
    },
}

#[derive(Args, Debug, Clone, Default)]
pub(crate) struct InboxArgs {
    /// Rolling window e.g. 24h, 3d (optional; use `--since` or config default for YYYY-MM-DD)
    pub(crate) window: Option<String>,
    #[arg(long)]
    pub(crate) since: Option<String>,
    #[arg(long)]
    pub(crate) mailbox: Option<String>,
    /// Accepted for agent compatibility; output is JSON by default unless `--text`.
    #[arg(long, hide = true)]
    pub(crate) json: bool,
    /// Slow path: all categories; recompute classifications (bypass cache); include archived; ignore prior surfaced dedup
    #[arg(long)]
    pub(crate) thorough: bool,
    #[arg(long, hide = true)]
    pub(crate) replay: bool,
    #[arg(long, hide = true)]
    pub(crate) include_all: bool,
    #[arg(long, hide = true)]
    pub(crate) reclassify: bool,
    #[arg(long)]
    pub(crate) diagnostics: bool,
    #[arg(long)]
    pub(crate) text: bool,
}

/// Appended to `ripmail draft --help` (long help only).
const DRAFT_CMD_AFTER_LONG_HELP: &str = "\
Prefer ripmail-assisted composition (better email shape than ad-hoc agent prose):
  ripmail draft new --to <addr> --instruction \"...\"           # LLM subject+body; omit --subject (needs LLM credentials)
  ripmail draft reply --message-id <id> --instruction \"...\"   # LLM reply (indexed message; optional --to)
  ripmail draft forward --message-id <id> --to <addr> --instruction \"...\"  # LLM preamble + forwarded block
  ripmail draft edit <id> \"...\"                                 # LLM revision of an existing draft
Use --body / --body-file only when the text must be verbatim (quotes, templates, compliance).
";

/// Appended to `ripmail rules --help` (long help only).
const RULES_CMD_AFTER_LONG_HELP: &str = "\
Add/edit always run inbox preview against $RIPMAIL_HOME/data (default ~/.ripmail)—your real synced index—not a throwaway empty home.

Examples (see ripmail rules add --help):
  ripmail rules add --action ignore --query 'from:no-reply@zoom.us meeting OR summary'
  ripmail rules move def-linkedin --before def-cat-list   # see ripmail rules move --help; prints compact full order
";

/// Appended to `ripmail rules add --help` (long help only).
const RULES_ADD_AFTER_LONG_HELP: &str = "\
Pass --query using the same language as `ripmail search` (from:, to:, subject:, after:, before:, category:, FTS terms, OR/AND). See ripmail rules validate.

Preview uses your normal ripmail home and data: config + SQLite at $RIPMAIL_HOME (default ~/.ripmail), same as sync/search.

Examples:
  ripmail rules add --action ignore --query 'from:newsletter.example.com'
  ripmail rules add --action notify --query 'verification OR otp OR 2fa'
  ripmail rules add --action ignore --query 'category:promotional'
Flags: --action <ACTION> --query <SEARCH_STRING> [--insert-before <RULE_ID>] [--description] [--preview-window] [--text]
";

/// Appended to `ripmail rules edit --help` (long help only).
const RULES_EDIT_AFTER_LONG_HELP: &str = "\
Change --action and/or --query (omit either to leave unchanged).

Preview uses your normal ripmail home and data: $RIPMAIL_HOME (default ~/.ripmail) and its ripmail.db, same as ripmail rules add.
";

/// Appended to `ripmail rules move --help` (long help only).
const RULES_MOVE_AFTER_LONG_HELP: &str = "\
Pass exactly one of --before or --after (another rule id). Precedence is list order (earlier = higher).
JSON stdout: { \"moved\": \"<id>\", \"rules\": [ { \"id\", \"action\" }, ... ] } for the full order after the move. --text: numbered lines (index, id, action).
Examples:
  ripmail rules move def-linkedin --before def-cat-list
  ripmail rules move abc1 --after def-noreply --text
";

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum RulesCmd {
    /// Validate ~/.ripmail/rules.json (schema, search query compile)
    Validate {
        /// Re-run match counts against your real ripmail.db (same queries as search)
        #[arg(long)]
        sample: bool,
    },
    /// Replace rules.json with bundled defaults (renames existing file to rules.json.bak.<uuid>)
    ResetDefaults {
        /// Required: confirm destructive replace
        #[arg(long)]
        yes: bool,
    },
    /// Show all rules
    List {
        #[arg(long)]
        text: bool,
    },
    /// Show a single rule by ID
    Show {
        id: String,
        #[arg(long)]
        text: bool,
    },
    /// Add a search rule (`ripmail search` query string)
    #[command(
        after_long_help = RULES_ADD_AFTER_LONG_HELP,
        help_template = "\
{about-with-newline}\
{usage-heading} {usage}\
{after-help}\
\n\
{all-args}\
"
    )]
    Add {
        #[arg(long, hide_long_help = true, help = "notify | inform | ignore")]
        action: String,
        #[arg(long, help = "same language as ripmail search")]
        query: String,
        #[arg(
            long = "insert-before",
            hide_long_help = true,
            help = "place new rule before this rule id (default: append)"
        )]
        insert_before: Option<String>,
        #[arg(long, hide_long_help = true, help = "note in rules.json")]
        description: Option<String>,
        #[arg(long, hide_long_help = true, help = "e.g. 7d")]
        preview_window: Option<String>,
        #[arg(long, hide_long_help = true, help = "text output")]
        text: bool,
    },
    /// Edit an existing rule
    #[command(
        after_long_help = RULES_EDIT_AFTER_LONG_HELP,
        help_template = "\
{about-with-newline}\
{usage-heading} {usage}\
{after-help}\
\n\
{all-args}\
"
    )]
    Edit {
        id: String,
        #[arg(long)]
        action: Option<String>,
        #[arg(long)]
        query: Option<String>,
        #[arg(long)]
        preview_window: Option<String>,
        #[arg(long)]
        text: bool,
    },
    /// Remove a rule by ID
    Remove {
        id: String,
        /// Accepted for automation (no extra prompt; remove is already non-interactive)
        #[arg(long, short = 'y')]
        yes: bool,
        #[arg(long)]
        text: bool,
    },
    /// Move a rule to a new position (ordered list precedence)
    #[command(
        after_long_help = RULES_MOVE_AFTER_LONG_HELP,
        help_template = "\
{about-with-newline}\
{usage-heading} {usage}\
{after-help}\
\n\
{all-args}\
"
    )]
    Move {
        /// Rule id to move
        id: String,
        #[arg(long, help = "place this rule before the given rule id")]
        before: Option<String>,
        #[arg(long, help = "place this rule after the given rule id")]
        after: Option<String>,
        #[arg(long)]
        text: bool,
    },
    /// Propose a rule from fuzzy feedback
    Feedback {
        feedback: String,
        #[arg(long)]
        text: bool,
    },
}

#[cfg(test)]
mod search_cli_tests {
    use super::Cli;
    use super::Commands;
    use clap::Parser;

    #[test]
    fn search_filter_only_from_parses_without_query() {
        // BUG-032: filter-only search should not require a positional <QUERY>
        let cli = Cli::try_parse_from(["ripmail", "search", "--from", "stiller", "--limit", "10"])
            .expect("filter-only search should parse without positional query");
        match cli.command {
            Some(Commands::Search {
                query, from, limit, ..
            }) => {
                assert!(query.is_none(), "query should be None when omitted");
                assert_eq!(from.as_deref(), Some("stiller"));
                assert_eq!(limit, Some(10));
            }
            _ => panic!("expected Search command"),
        }
    }

    #[test]
    fn search_with_query_still_parses() {
        let cli = Cli::try_parse_from(["ripmail", "search", "invoice", "--limit", "5"])
            .expect("search with query should still parse");
        match cli.command {
            Some(Commands::Search { query, limit, .. }) => {
                assert_eq!(query.as_deref(), Some("invoice"));
                assert_eq!(limit, Some(5));
            }
            _ => panic!("expected Search command"),
        }
    }

    #[test]
    fn search_no_query_no_filters_is_accepted_by_parser() {
        // Parser accepts it; run_search validates and rejects at runtime
        let result = Cli::try_parse_from(["ripmail", "search"]);
        assert!(
            result.is_ok(),
            "bare search should parse (runtime validates)"
        );
    }

    #[test]
    fn search_since_parses() {
        let cli = Cli::try_parse_from(["ripmail", "search", "--since", "7d", "--from", "a@b.com"])
            .expect("parse");
        match cli.command {
            Some(Commands::Search {
                since, after, from, ..
            }) => {
                assert_eq!(since.as_deref(), Some("7d"));
                assert!(after.is_none());
                assert_eq!(from.as_deref(), Some("a@b.com"));
            }
            _ => panic!("expected Search command"),
        }
    }

    #[test]
    fn search_since_short_flag_parses() {
        let cli = Cli::try_parse_from(["ripmail", "search", "-s", "7d", "--from", "a@b.com"])
            .expect("parse");
        match cli.command {
            Some(Commands::Search { since, .. }) => {
                assert_eq!(since.as_deref(), Some("7d"));
            }
            _ => panic!("expected Search command"),
        }
    }

    #[test]
    fn search_after_and_since_conflict() {
        let cli = Cli::try_parse_from(["ripmail", "search", "--after", "7d", "--since", "1y"]);
        assert!(cli.is_err(), "expected --after and --since to conflict");
    }
}

#[cfg(test)]
mod draft_cli_tests {
    use super::Cli;
    use super::Commands;
    use super::RulesCmd;
    use clap::Parser;
    use ripmail::draft::DraftCmd;

    #[test]
    fn rules_add_parses_query() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "rules",
            "add",
            "--action",
            "notify",
            "--query",
            "from:list@example.com",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, mailbox }) => {
                assert!(mailbox.is_none());
                match sub {
                    RulesCmd::Add { action, query, .. } => {
                        assert_eq!(action, "notify");
                        assert_eq!(query, "from:list@example.com");
                    }
                    _ => panic!("expected rules add"),
                }
            }
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn rules_add_parses_insert_before() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "rules",
            "add",
            "--action",
            "notify",
            "--query",
            "newsletter",
            "--insert-before",
            "def-otp",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, .. }) => match sub {
                RulesCmd::Add {
                    insert_before,
                    query,
                    ..
                } => {
                    assert_eq!(insert_before.as_deref(), Some("def-otp"));
                    assert_eq!(query, "newsletter");
                }
                _ => panic!("expected rules add"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn rules_move_parses_before() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "rules",
            "move",
            "abc1",
            "--before",
            "def-otp-subject",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, .. }) => match sub {
                RulesCmd::Move {
                    id, before, after, ..
                } => {
                    assert_eq!(id, "abc1");
                    assert_eq!(before.as_deref(), Some("def-otp-subject"));
                    assert!(after.is_none());
                }
                _ => panic!("expected rules move"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    /// BUG-052: `rules remove` must accept `-y` / `--yes` (automation parity with other destructive commands).
    #[test]
    fn rules_remove_parses_yes_short_flag() {
        let cli =
            Cli::try_parse_from(["ripmail", "rules", "remove", "rule-id-1", "-y"]).expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, .. }) => match sub {
                RulesCmd::Remove { id, yes, text } => {
                    assert_eq!(id, "rule-id-1");
                    assert!(yes);
                    assert!(!text);
                }
                _ => panic!("expected rules remove"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn draft_reply_parses_instruction() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "draft",
            "reply",
            "--message-id",
            "<x@y>",
            "--instruction",
            "Say thanks",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Draft { sub }) => match sub {
                DraftCmd::Reply {
                    instruction,
                    indexed,
                    ..
                } => {
                    assert_eq!(instruction.as_deref(), Some("Say thanks"));
                    assert_eq!(indexed.message_id_flag.as_deref(), Some("<x@y>"));
                }
                _ => panic!("expected draft reply"),
            },
            _ => panic!("expected draft"),
        }
    }

    #[test]
    fn draft_forward_parses_instruction() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "draft",
            "forward",
            "--message-id",
            "<x@y>",
            "--to",
            "team@example.com",
            "--instruction",
            "FYI",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Draft { sub }) => match sub {
                DraftCmd::Forward {
                    instruction,
                    to,
                    indexed,
                    ..
                } => {
                    assert_eq!(instruction.as_deref(), Some("FYI"));
                    assert_eq!(to.as_str(), "team@example.com");
                    assert_eq!(indexed.message_id_flag.as_deref(), Some("<x@y>"));
                }
                _ => panic!("expected draft forward"),
            },
            _ => panic!("expected draft"),
        }
    }

    #[test]
    fn draft_reply_instruction_conflicts_with_body() {
        let err = match Cli::try_parse_from([
            "ripmail",
            "draft",
            "reply",
            "--message-id",
            "a",
            "--instruction",
            "x",
            "--body",
            "y",
        ]) {
            Err(e) => e,
            Ok(_) => panic!("expected --instruction/--body conflict"),
        };
        let s = err.to_string();
        assert!(
            s.contains("instruction") && s.contains("body") || s.contains("cannot be used with"),
            "{s}"
        );
    }

    #[test]
    fn draft_list_accepts_json_flag_for_agents() {
        let cli = Cli::try_parse_from(["ripmail", "draft", "list", "--json"]).expect("parse");
        match cli.command {
            Some(super::Commands::Draft { sub }) => match sub {
                DraftCmd::List {
                    text: false,
                    json: true,
                    ..
                } => {}
                _ => panic!("unexpected draft subcommand"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn draft_list_text_conflicts_with_json() {
        let err = match Cli::try_parse_from(["ripmail", "draft", "list", "--text", "--json"]) {
            Err(e) => e,
            Ok(_) => panic!("expected --text/--json conflict"),
        };
        let s = err.to_string();
        assert!(
            s.contains("text") && s.contains("json") || s.contains("cannot be used with"),
            "{s}"
        );
    }

    #[test]
    fn draft_rewrite_parses_add_cc_and_keep_body() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "draft",
            "rewrite",
            "rid",
            "--add-cc",
            "a@b.com",
            "--add-cc",
            "c@d.com",
            "--keep-body",
            "--text",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Draft { sub }) => match sub {
                DraftCmd::Rewrite {
                    id,
                    add_cc,
                    keep_body,
                    text: true,
                    ..
                } => {
                    assert_eq!(id, "rid");
                    assert_eq!(add_cc, vec!["a@b.com", "c@d.com"]);
                    assert!(keep_body);
                }
                _ => panic!("expected draft rewrite"),
            },
            _ => panic!("expected draft"),
        }
    }

    #[test]
    fn draft_edit_parses_recipient_flags_before_instruction() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "draft",
            "edit",
            "id1",
            "--remove-cc",
            "old@x.com",
            "--add-to",
            "new@y.com",
            "fix",
            "tone",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Draft { sub }) => match sub {
                DraftCmd::Edit {
                    id,
                    add_to,
                    remove_cc,
                    instruction,
                    ..
                } => {
                    assert_eq!(id, "id1");
                    assert_eq!(add_to, vec!["new@y.com"]);
                    assert_eq!(remove_cc, vec!["old@x.com"]);
                    assert_eq!(instruction, vec!["fix", "tone"]);
                }
                _ => panic!("expected draft edit"),
            },
            _ => panic!("expected draft"),
        }
    }

    /// BUG-054: `draft edit` has no `--body` flag; after `--`, `--body` is a literal trailing token.
    #[test]
    fn draft_edit_parses_double_hyphen_with_body_token() {
        let cli = Cli::try_parse_from(["ripmail", "draft", "edit", "id1", "--", "--body", "hello"])
            .expect("parse");
        match cli.command {
            Some(Commands::Draft { sub }) => match sub {
                DraftCmd::Edit {
                    id, instruction, ..
                } => {
                    assert_eq!(id, "id1");
                    assert_eq!(instruction, vec!["--body", "hello"]);
                }
                _ => panic!("expected draft edit"),
            },
            _ => panic!("expected draft"),
        }
    }
}
