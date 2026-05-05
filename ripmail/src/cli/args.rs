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
    /// Wall-clock limit in seconds for long commands (`refresh`, `backfill --foreground`, …). 0 = no limit.
    /// If omitted, `RIPMAIL_TIMEOUT` applies to sync commands.
    #[arg(
        long = "timeout",
        visible_alias = "wall-timeout",
        global = true,
        env = "RIPMAIL_TIMEOUT",
        value_name = "SECS"
    )]
    pub(crate) timeout_secs: Option<u64>,
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
    --google-oauth         Gmail: browser OAuth instead of app password (tokens under $RIPMAIL_HOME/<id>/)
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
Deletes every top-level file and directory under RIPMAIL_HOME (default $BRAIN_HOME/ripmail when unset): config, SQLite index, secrets, per-mailbox dirs, logs, rules — same scope as `ripmail wizard --clean`.

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

/// `calendar cancel-event --scope` (recurring semantics).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CancelMutationScopeCli {
    This,
    Future,
    All,
}

/// `calendar delete-event --scope`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeleteMutationScopeCli {
    This,
    All,
}

fn parse_cancel_scope(s: &str) -> Result<CancelMutationScopeCli, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "this" => Ok(CancelMutationScopeCli::This),
        "future" => Ok(CancelMutationScopeCli::Future),
        "all" => Ok(CancelMutationScopeCli::All),
        x => Err(format!("expected this|future|all, got {x:?}")),
    }
}

fn parse_delete_scope(s: &str) -> Result<DeleteMutationScopeCli, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "this" => Ok(DeleteMutationScopeCli::This),
        "all" => Ok(DeleteMutationScopeCli::All),
        x => Err(format!("expected this|all, got {x:?}")),
    }
}

#[derive(Subcommand)]
pub(crate) enum Commands {
    /// Write config under RIPMAIL_HOME (non-interactive)
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
        /// With `--google-oauth`, include Google Drive read-only scope (for Drive indexing).
        #[arg(long, requires = "google_oauth")]
        drive: bool,
        #[command(flatten)]
        identity: IdentityArgs,
    },
    /// Update non-secret settings in config.json (identity, mailbox management)
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
    /// Incremental IMAP sync: new mail and forward checkpoint only (fast; schedule often).
    #[command(name = "refresh")]
    Refresh {
        /// Sync only this source (email or id from config); default = all configured
        #[arg(long, short = 'S', alias = "mailbox")]
        source: Option<String>,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        text: bool,
        /// Extra DEBUG lines in the sync log (and stderr progress mirrored to the log when set)
        #[arg(long, short = 'v')]
        verbose: bool,
    },
    /// Historical mail download for a time window (idempotent; skips already-indexed messages).
    #[command(name = "backfill")]
    Backfill {
        /// Window to cover, e.g. `1y`, `2y`, `180d` (default: `sync.defaultSince` from config)
        duration: Option<String>,
        #[arg(long, short = 's')]
        since: Option<String>,
        #[arg(long, short = 'S', alias = "mailbox")]
        source: Option<String>,
        #[arg(long, alias = "fg")]
        foreground: bool,
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
    /// Search mail and indexed files: regex pattern + filters (JSON by default)
    Search {
        /// Regex pattern matched against subject + body (use `a|b` for alternation). Optional when filter flags are provided.
        query: Option<String>,
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        case_sensitive: bool,
        /// Only messages on or after this date (ISO `YYYY-MM-DD` or rolling spec e.g. `7d`, `1y`)
        #[arg(long)]
        after: Option<String>,
        /// Same lower bound as `--after` (rolling or ISO)
        #[arg(long, short = 's', conflicts_with = "after")]
        since: Option<String>,
        /// Only messages on or before this date (ISO or rolling spec)
        #[arg(long)]
        before: Option<String>,
        #[arg(long, short = 'S')]
        source: Option<String>,
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
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        include_noreply: bool,
        #[arg(long)]
        text: bool,
    },
    /// Configured identity (name, addresses) plus optional inference from indexed mail
    #[command(name = "whoami")]
    Whoami {
        /// Limit to one source (email or id from config)
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        text: bool,
    },
    /// Read one or more messages (raw .eml or headers + body); multiple ids = batch (JSON array, text with separators)
    Read {
        #[arg(value_name = "TARGET", num_args = 1..)]
        message_ids: Vec<String>,
        /// Narrow Message-ID resolution when ambiguous; ignored for filesystem paths
        #[arg(long, short = 'S')]
        source: Option<String>,
        /// Prefer MIME text/plain when non-empty (skip HTML→markdown heuristic). Useful for agents; the app UI keeps the default.
        #[arg(long)]
        plain_body: bool,
        /// For `read <file>` local paths, return full extracted/plain text (default caps at 50k chars for agent context). Ignored for indexed mailbox Message-IDs (those already return the full MIME body).
        #[arg(long)]
        full_body: bool,
        #[arg(long)]
        raw: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        /// Include `bodyHtml` in JSON output. Omitted by default to reduce token use.
        /// The app UI must pass this flag when it needs HTML for iframe rendering.
        #[arg(long)]
        include_html: bool,
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
        #[arg(long, short = 'S')]
        source: Option<String>,
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
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        text: bool,
    },
    /// Local drafts under data/drafts/ (list, view, new, reply, forward, edit, rewrite)
    #[command(after_long_help = DRAFT_CMD_AFTER_LONG_HELP)]
    Draft {
        #[command(subcommand)]
        sub: ripmail::draft::DraftCmd,
    },
    /// Manage inbox rules in $RIPMAIL_HOME/rules.json
    #[command(after_long_help = RULES_CMD_AFTER_LONG_HELP)]
    Rules {
        /// Target `$RIPMAIL_HOME/<id>/rules.json` overlay (email or id); omit for global `rules.json`
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[command(subcommand)]
        sub: RulesCmd,
    },
    /// List or manage configured sources (IMAP, Apple Mail, local directory, calendar)
    Sources {
        #[command(subcommand)]
        sub: SourcesCmd,
    },
    /// Search and read indexed calendar events ([OPP-053](https://github.com/cirne/zmail))
    Calendar {
        #[command(subcommand)]
        sub: CalendarCmd,
    },
    /// Database counts
    Stats {
        #[arg(long)]
        json: bool,
    },
    /// Rebuild SQLite index from maildir tree
    #[command(name = "rebuild-index")]
    RebuildIndex,
    /// Clear stale `sync_summary` PID locks (refresh and backfill lanes) when no live process holds them
    Lock {
        #[command(subcommand)]
        sub: LockCmd,
    },
}

/// `ripmail lock` — operator recovery for stuck sync state after a crash.
#[derive(Subcommand)]
pub(crate) enum LockCmd {
    /// Reset `sync_summary` lock columns for refresh (`id=1`) and backfill (`id=2`) when not held by a live PID
    Clear,
}

#[derive(Subcommand)]
pub(crate) enum SkillCmd {
    /// Copy the embedded `/ripmail` skill to Claude Code and OpenClaw (when configured)
    Install,
}

/// `ripmail sources` — CRUD for `config.json` `sources[]`.
#[derive(Subcommand)]
#[allow(clippy::large_enum_variant)] // clap aggregates many optional flags on Add
pub(crate) enum SourcesCmd {
    /// List all sources
    List {
        #[arg(long)]
        json: bool,
    },
    /// Add a source (prints JSON `{"id":"..."}` on success when `--json`)
    Add {
        /// `imap` | `applemail` | `localDir` (camelCase)
        #[arg(long)]
        kind: String,
        /// `icsFile` / optional legacy single-dir: one filesystem path
        #[arg(long)]
        path: Option<String>,
        /// Indexed folder: absolute path (`localDir`) or Drive folder id (`googleDrive`). Repeat for multiple.
        #[arg(long = "root-id")]
        root_id: Vec<String>,
        /// Optional display name per `--root-id` (same order; default: directory / folder name)
        #[arg(long = "root-name")]
        root_name: Vec<String>,
        /// Set when added roots should not crawl subfolders (all roots in this invocation).
        #[arg(long = "no-root-recursive")]
        no_root_recursive: bool,
        /// Gitignore-style globs relative to root / file name (repeatable)
        #[arg(long = "include-glob")]
        include_glob: Vec<String>,
        #[arg(long = "ignore-glob")]
        ignore_glob: Vec<String>,
        #[arg(long = "max-file-bytes")]
        max_file_bytes: Option<u64>,
        /// `localDir` only (default true)
        #[arg(long)]
        respect_gitignore: Option<bool>,
        /// Optional display label (used to derive id when omitted)
        #[arg(long)]
        label: Option<String>,
        /// Stable id (default: derived from email or label or path)
        #[arg(long)]
        id: Option<String>,
        /// Required for `imap`: account email
        #[arg(long)]
        email: Option<String>,
        #[arg(long)]
        imap_host: Option<String>,
        #[arg(long)]
        imap_port: Option<u16>,
        #[arg(long = "apple-mail-path")]
        apple_mail_path: Option<String>,
        /// `googleCalendar`: reuse OAuth token from this source id’s directory (`google-oauth.json`).
        #[arg(long)]
        oauth_source_id: Option<String>,
        /// `googleCalendar`: remote calendar id (repeat for multiple; default `primary` if omitted).
        #[arg(long = "calendar")]
        calendar: Vec<String>,
        /// Calendar IDs to show by default (repeat for multiple; subset of --calendar).
        #[arg(long = "default-calendar")]
        default_calendar: Vec<String>,
        /// `icsSubscription`: HTTPS URL to fetch.
        #[arg(long)]
        url: Option<String>,
        /// `googleDrive`: include Shared-with-me corpus (same OAuth)
        #[arg(long)]
        include_shared_with_me: bool,
        #[arg(long)]
        json: bool,
    },
    /// Update an existing source by id
    Edit {
        #[arg(required = true)]
        id: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        path: Option<String>,
        /// Calendar IDs to sync (repeat for multiple; replaces existing list).
        #[arg(long = "calendar")]
        calendar: Vec<String>,
        /// Calendar IDs to show by default (repeat for multiple; subset of --calendar).
        #[arg(long = "default-calendar")]
        default_calendar: Vec<String>,
        /// Replace entire `fileSource` JSON (localDir / googleDrive)
        #[arg(long = "file-source-json")]
        file_source_json: Option<String>,
        /// `googleDrive`: set whether Shared-with-me corpus is included (true/false)
        #[arg(long = "include-shared-with-me")]
        include_shared_with_me: Option<bool>,
        #[arg(long)]
        json: bool,
    },
    /// List child folders (local path or Drive folder id) for the Hub folder picker
    #[command(name = "browse-folders")]
    BrowseFolders {
        #[arg(long)]
        id: String,
        #[arg(long = "parent-id")]
        parent_id: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Remove {
        #[arg(required = true)]
        id: String,
        #[arg(long)]
        json: bool,
    },
    /// Show crawl/sync status hints from config + DB
    Status {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
pub(crate) enum CalendarCmd {
    /// List calendar ids per configured source (from config)
    #[command(name = "list-calendars")]
    ListCalendars {
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Create an event on Google Calendar (googleCalendar sources only; requires `calendar.events` OAuth scope)
    #[command(name = "create-event")]
    CreateEvent {
        /// `googleCalendar` source id (from `ripmail calendar list-calendars --json` → `sourceId`)
        #[arg(long, short = 'S', required = true)]
        source: String,
        /// Google calendar id (default: `primary`)
        #[arg(long, default_value = "primary")]
        calendar: String,
        /// Event title
        #[arg(long, required = true)]
        title: String,
        /// All-day event: pass with `--date` (use timed mode without this flag)
        #[arg(long, default_value_t = false)]
        all_day: bool,
        /// All-day: local date (YYYY-MM-DD)
        #[arg(long)]
        date: Option<String>,
        /// Timed: start (RFC3339, e.g. `2026-04-23T15:00:00-04:00`)
        #[arg(long)]
        start: Option<String>,
        /// Timed: end (RFC3339)
        #[arg(long)]
        end: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        location: Option<String>,
        #[arg(long)]
        recurrence_preset: Option<String>,
        #[arg(long)]
        rrule: Option<String>,
        #[arg(long)]
        recurrence_count: Option<u32>,
        #[arg(long)]
        recurrence_until: Option<String>,
        #[arg(long)]
        json: bool,
    },
    #[command(name = "update-event")]
    UpdateEvent {
        #[arg(long, short = 'S', required = true)]
        source: String,
        #[arg(long, default_value = "primary")]
        calendar: String,
        /// Stored event `uid` (Google resource id — same field returned in `calendar range --json`).
        #[arg(long, required = true)]
        event_id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        location: Option<String>,
        #[arg(long, default_value_t = false)]
        all_day: bool,
        #[arg(long)]
        date: Option<String>,
        #[arg(long)]
        start: Option<String>,
        #[arg(long)]
        end: Option<String>,
        #[arg(long)]
        recurrence_preset: Option<String>,
        #[arg(long)]
        rrule: Option<String>,
        #[arg(long)]
        recurrence_count: Option<u32>,
        #[arg(long)]
        recurrence_until: Option<String>,
        #[arg(long)]
        json: bool,
    },
    #[command(name = "cancel-event")]
    CancelEvent {
        #[arg(long, short = 'S', required = true)]
        source: String,
        #[arg(long, default_value = "primary")]
        calendar: String,
        #[arg(long, required = true)]
        event_id: String,
        #[arg(long, value_parser = parse_cancel_scope)]
        scope: Option<CancelMutationScopeCli>,
        #[arg(long)]
        json: bool,
    },
    #[command(name = "delete-event")]
    DeleteEvent {
        #[arg(long, short = 'S', required = true)]
        source: String,
        #[arg(long, default_value = "primary")]
        calendar: String,
        #[arg(long, required = true)]
        event_id: String,
        #[arg(long, value_parser = parse_delete_scope)]
        scope: Option<DeleteMutationScopeCli>,
        #[arg(long)]
        json: bool,
    },
    Today {
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Upcoming {
        #[arg(long, default_value_t = 7)]
        days: u32,
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Search {
        query: String,
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long, short = 'S')]
        source: Option<String>,
        /// Optional calendar IDs (repeat); when set, overrides default_calendars from config
        #[arg(long = "calendar")]
        calendar: Vec<String>,
        #[arg(long)]
        json: bool,
    },
    /// Events overlapping inclusive from/to dates (YYYY-MM-DD), UTC calendar-day bounds.
    Range {
        #[arg(long)]
        from: String,
        #[arg(long)]
        to: String,
        #[arg(long, short = 'S')]
        source: Option<String>,
        /// Optional calendar IDs to filter by (repeat for multiple)
        #[arg(long = "calendar")]
        calendar: Vec<String>,
        #[arg(long)]
        json: bool,
    },
    Read {
        /// Event `uid` (or numeric row id)
        target: String,
        #[arg(long, short = 'S')]
        source: Option<String>,
        #[arg(long)]
        json: bool,
    },
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
    #[arg(long, short = 'S')]
    pub(crate) source: Option<String>,
    /// Accepted for agent compatibility; output is JSON by default unless `--text`.
    #[arg(long, hide = true)]
    pub(crate) json: bool,
    /// Slow path: all categories; recompute classifications (bypass cache); include archived; ignore prior surfaced dedup
    #[arg(long)]
    pub(crate) thorough: bool,
    /// Re-run triage with the current ruleset on mail already in the index (bypasses inbox cache; same scan as --thorough). Use after editing rules.json to refresh classifications and local archive flags in the inbox window.
    #[arg(long)]
    pub(crate) reapply: bool,
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
Add/edit always run inbox preview against $RIPMAIL_HOME/data (default $BRAIN_HOME/ripmail when unset)—your real synced index—not a throwaway empty home.

Examples (see ripmail rules add --help):
  ripmail rules add --action ignore --from 'no-reply@zoom.us' --query 'meeting|summary'
  ripmail rules add --action ignore --query 'golf|tee time' --message-only   # rare: match per message, not whole thread
  ripmail rules move def-linkedin --before def-cat-list   # see ripmail rules move --help; prints compact full order
";

/// Appended to `ripmail rules add --help` (long help only).
const RULES_ADD_AFTER_LONG_HELP: &str = "\
Rule matching uses the same engine as `ripmail search`, but the **--query** string is only the **subject+body pattern** (regex/FTS). Do **not** put `from:`, `subject:`, `category:`, etc. inside `--query`—those tokens are rejected. Use **--from**, **--to**, **--subject**, and **--category** for structured filters (like `ripmail search` flags). You must pass at least one of `--query` or those filters. Combined pattern + filters are **AND**ed. For **OR** between different dimensions (e.g. sender vs subject phrase), use **separate rules** or a single pattern that matches either in the text. When both `--from` and `--to` are set, pass `--from-or-to-union true` to match if **either** address applies.

Thread scope (default): when a rule matches any message in a conversation (same thread id in the index), every other still-pending message in that thread in the inbox window gets the same classification. Use --message-only to restrict to matching messages only (legacy behavior). In rules.json this is `threadScope` (default true).

Preview uses your normal ripmail home and data: config + SQLite at $RIPMAIL_HOME (default $BRAIN_HOME/ripmail when unset), same as sync/search.

Examples:
  ripmail rules add --action ignore --from 'newsletter.example.com'
  ripmail rules add --action notify --query 'verification|otp|2fa'
  ripmail rules add --action ignore --category promotional
Flags: --action <ACTION> [--query <PATTERN>] [--from] [--to] [--subject] [--category] [--from-or-to-union <BOOL>] [--message-only] [--insert-before <RULE_ID>] [--description] [--preview-window] [--text]
";

/// Appended to `ripmail rules edit --help` (long help only).
const RULES_EDIT_AFTER_LONG_HELP: &str = "\
Change --action, --query, and/or structured filters (omit a flag to leave that field unchanged). Pass an empty value to clear a structured filter, e.g. `--from \"\"`. Clearing --query sets an empty pattern; the rule must still have another criterion. Thread scope: --whole-thread or --message-only. Optional: --from-or-to-union true|false to set `fromOrToUnion`.

Preview uses your normal ripmail home and data: $RIPMAIL_HOME (default $BRAIN_HOME/ripmail when unset) and its ripmail.db, same as ripmail rules add.
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
    /// Validate rules.json (schema, search query compile)
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
    /// Add a search rule (pattern + optional structured filters)
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
        #[arg(
            long,
            hide_long_help = true,
            help = "subject+body pattern (no inline from:/subject:); optional if --from/--to/--subject/--category set"
        )]
        query: Option<String>,
        #[arg(
            long,
            hide_long_help = true,
            help = "From filter (substring; same idea as ripmail search --from)"
        )]
        from: Option<String>,
        #[arg(long, hide_long_help = true, help = "To filter (ripmail search --to)")]
        to: Option<String>,
        #[arg(
            long,
            hide_long_help = true,
            help = "Subject filter (ripmail search --subject)"
        )]
        subject: Option<String>,
        #[arg(
            long,
            hide_long_help = true,
            help = "Category label (ripmail search --category)"
        )]
        category: Option<String>,
        #[arg(
            long = "from-or-to-union",
            hide_long_help = true,
            help = "when both --from and --to are set, match if either applies (default false)"
        )]
        from_or_to_union: bool,
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
        /// Match individual messages only; do not apply the rule to the whole conversation thread
        #[arg(long = "message-only")]
        message_only: bool,
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
        #[arg(long, help = "set or clear From filter (empty string clears)")]
        from: Option<String>,
        #[arg(long, help = "set or clear To filter (empty string clears)")]
        to: Option<String>,
        #[arg(long, help = "set or clear Subject filter (empty string clears)")]
        subject: Option<String>,
        #[arg(long, help = "set or clear category (empty string clears)")]
        category: Option<String>,
        #[arg(
            long = "from-or-to-union",
            value_parser = clap::builder::BoolishValueParser::new(),
            help = "set fromOrToUnion (omit to leave unchanged)"
        )]
        from_or_to_union: Option<bool>,
        #[arg(
            long = "message-only",
            group = "edit_thread_scope",
            help = "set rule to message-only matching (`threadScope: false`)"
        )]
        set_message_only: bool,
        #[arg(
            long = "whole-thread",
            group = "edit_thread_scope",
            help = "set rule to apply to the full thread when any message matches (`threadScope: true`)"
        )]
        set_whole_thread: bool,
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
    fn rules_add_parses_from_and_query() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "rules",
            "add",
            "--action",
            "notify",
            "--from",
            "list@example.com",
            "--query",
            "digest",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, source }) => {
                assert!(source.is_none());
                match sub {
                    RulesCmd::Add {
                        action,
                        query,
                        from,
                        from_or_to_union,
                        ..
                    } => {
                        assert_eq!(action, "notify");
                        assert_eq!(query.as_deref(), Some("digest"));
                        assert_eq!(from.as_deref(), Some("list@example.com"));
                        assert!(!from_or_to_union);
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
                    assert_eq!(query.as_deref(), Some("newsletter"));
                }
                _ => panic!("expected rules add"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn rules_add_parses_message_only() {
        let cli = Cli::try_parse_from([
            "ripmail",
            "rules",
            "add",
            "--action",
            "ignore",
            "--query",
            "golf",
            "--message-only",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, .. }) => match sub {
                RulesCmd::Add {
                    query,
                    message_only,
                    ..
                } => {
                    assert_eq!(query.as_deref(), Some("golf"));
                    assert!(message_only);
                }
                _ => panic!("expected rules add"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn rules_edit_parses_whole_thread() {
        let cli = Cli::try_parse_from(["ripmail", "rules", "edit", "abc1", "--whole-thread"])
            .expect("parse");
        match cli.command {
            Some(Commands::Rules { sub, .. }) => match sub {
                RulesCmd::Edit {
                    id,
                    set_message_only,
                    set_whole_thread,
                    ..
                } => {
                    assert_eq!(id, "abc1");
                    assert!(!set_message_only);
                    assert!(set_whole_thread);
                }
                _ => panic!("expected rules edit"),
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

#[cfg(test)]
mod archive_cli_tests {
    use super::Cli;
    use super::Commands;
    use clap::Parser;

    /// BUG-039: Message-ID starting with hyphen is parsed as flag
    #[test]
    fn archive_leading_dash_message_id_fails_without_double_dash() {
        // This should fail because clap interprets -OSgr as a flag
        let result = Cli::try_parse_from(["ripmail", "archive", "-OSgr@geopod-ismtpd-101"]);

        // Expect this to fail with a flag parsing error
        match result {
            Err(e) => {
                let err_str = e.to_string();
                // The error should mention unexpected argument or unknown flag
                assert!(
                    err_str.contains("unexpected argument")
                        || err_str.contains("unrecognized")
                        || err_str.contains("found argument")
                        || err_str.contains("unexpected"),
                    "Error should indicate flag parsing issue, got: {err_str}"
                );
            }
            Ok(_) => panic!("BUG-039: Leading-dash message ID should fail (parsed as flag)"),
        }
    }

    #[test]
    fn archive_leading_dash_message_id_works_with_double_dash() {
        // Using -- to terminate flag parsing should work
        let cli = Cli::try_parse_from(["ripmail", "archive", "--", "-OSgr@geopod-ismtpd-101"])
            .expect("parse with -- should work");

        match cli.command {
            Some(Commands::Archive { message_ids, .. }) => {
                assert_eq!(message_ids.len(), 1);
                assert_eq!(message_ids[0], "-OSgr@geopod-ismtpd-101");
            }
            _ => panic!("expected Archive command"),
        }
    }

    #[test]
    fn archive_normal_message_id_works() {
        // Normal message IDs without leading dash should work fine
        let cli = Cli::try_parse_from(["ripmail", "archive", "OSgr@geopod-ismtpd-101"])
            .expect("normal message ID should parse");

        match cli.command {
            Some(Commands::Archive { message_ids, .. }) => {
                assert_eq!(message_ids.len(), 1);
                assert_eq!(message_ids[0], "OSgr@geopod-ismtpd-101");
            }
            _ => panic!("expected Archive command"),
        }
    }

    #[test]
    fn archive_bracketed_leading_dash_message_id_fails() {
        // Even with angle brackets, leading dash after < is problematic
        let result = Cli::try_parse_from(["ripmail", "archive", "<-OSgr@geopod-ismtpd-101>"]);

        // This might work or fail depending on how clap handles it
        // Document the actual behavior
        if result.is_err() {
            println!("BUG-039: Even bracketed leading-dash message ID fails");
        }
    }

    #[test]
    fn archive_multiple_message_ids_one_with_leading_dash() {
        // Multiple message IDs where one has a leading dash
        let result =
            Cli::try_parse_from(["ripmail", "archive", "good@example.com", "-bad@example.com"]);

        assert!(
            result.is_err(),
            "BUG-039: Leading-dash message ID in multi-message batch should fail"
        );
    }
}
