//! Interactive `ripmail wizard` — printed banner + inquire prompts (Node `wizard.ts` parity).

use std::fmt;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};

use indicatif::{ProgressBar, ProgressStyle};
use inquire::validator::Validation;
use inquire::Confirm;
use inquire::{Password, PasswordDisplayMode, Select, Text as InquireText};

use crate::agent_skill_install::{
    claude_skill_dest, install_skill_from_embed_with_options, skip_claude_skill_install,
    skip_openclaw_skill_install, InstallSkillFromEmbedOptions,
};
use crate::config::{
    derive_mailbox_id_from_email, load_config, load_config_json, write_config_json, IdentityPatch,
    ImapJson, LoadConfigOptions, MailboxConfigJson, MailboxSearchJson,
};
use crate::db;
use crate::send::{verify_smtp_credentials, verify_smtp_for_config};
use crate::setup::{
    derive_imap_settings, load_existing_env_secrets, load_imap_password_for_mailbox_id,
    load_mailbox_configs_for_wizard, mask_secret, merge_root_openai_key,
    remove_mailbox_from_config, replace_mailbox_entry, update_mailbox_management,
    update_sync_default_since, upsert_mailbox_applemail, upsert_mailbox_setup,
    validate_imap_credentials, validate_openai_key, wizard_is_first_mailbox_setup,
    write_google_oauth_setup,
};
use crate::sync::spawn_sync_background_detached;

const NON_TTY_MSG: &str = "Wizard requires an interactive terminal. Use `ripmail setup` instead.";

/// Options for `ripmail wizard` (Node `runWizard` flags).
#[derive(Debug, Clone)]
pub struct WizardOptions {
    pub home: PathBuf,
    pub no_validate: bool,
    pub clean: bool,
    pub yes: bool,
}

#[derive(Clone)]
struct SyncChoice {
    value: &'static str,
    name: &'static str,
    desc: &'static str,
}

impl fmt::Display for SyncChoice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} — {}", self.name, self.desc)
    }
}

const SYNC_CHOICES: &[SyncChoice] = &[
    SyncChoice {
        value: "7d",
        name: "7 days",
        desc: "Quick start, recent email only",
    },
    SyncChoice {
        value: "5w",
        name: "5 weeks",
        desc: "",
    },
    SyncChoice {
        value: "3m",
        name: "3 months",
        desc: "",
    },
    SyncChoice {
        value: "1y",
        name: "1 year (recommended)",
        desc: "Good balance of history and sync time",
    },
    SyncChoice {
        value: "2y",
        name: "2 years",
        desc: "",
    },
];

/// One row per inbox, add paths (IMAP; Apple Mail on macOS; Gmail OAuth), or exit.
#[derive(Clone)]
#[allow(clippy::large_enum_variant)]
enum InboxMenuChoice {
    Mailbox(MailboxPick),
    AddImap,
    /// macOS only (omitted from the menu elsewhere).
    AddAppleMail,
    AddGmailOAuth,
    Done,
}

impl fmt::Display for InboxMenuChoice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InboxMenuChoice::Mailbox(p) => write!(f, "{}", p.label),
            InboxMenuChoice::AddImap => {
                write!(f, "Add mailbox — IMAP (email & password, any provider)")
            }
            InboxMenuChoice::AddAppleMail => {
                write!(f, "Add mailbox — Apple Mail (local index)")
            }
            InboxMenuChoice::AddGmailOAuth => {
                write!(f, "Add mailbox — Gmail (Sign in with Google)")
            }
            InboxMenuChoice::Done => write!(f, "Done"),
        }
    }
}

#[derive(Clone)]
enum MailboxAction {
    Edit,
    Delete,
    Back,
}

impl fmt::Display for MailboxAction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MailboxAction::Edit => write!(f, "Edit this mailbox"),
            MailboxAction::Delete => write!(f, "Delete this mailbox"),
            MailboxAction::Back => write!(f, "Back"),
        }
    }
}

#[derive(Clone)]
struct MailboxPick {
    label: String,
    entry: MailboxConfigJson,
}

impl fmt::Display for MailboxPick {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.label)
    }
}

/// Print a multi-line ASCII banner to the terminal (non-blocking, like other CLI tools).
fn print_welcome_banner() {
    let color = io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let (bold_cyan, dim, reset) = if color {
        ("\x1b[1;36m", "\x1b[2m", "\x1b[0m")
    } else {
        ("", "", "")
    };
    let logo = concat!(
        "███████╗███╗   ███╗ █████╗ ██╗██╗     \n",
        "╚══███╔╝████╗ ████║██╔══██╗██║██║     \n",
        "  ███╔╝ ██╔████╔██║███████║██║██║     \n",
        " ███╔╝  ██║╚██╔╝██║██╔══██║██║██║     \n",
        "███████╗██║ ╚═╝ ██║██║  ██║██║███████╗\n",
        "╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝",
    );
    println!();
    println!("{bold_cyan}{logo}{reset}");
    println!("{dim}  agent-first email{reset}");
    println!("{dim}  Let's get you connected{reset}");
    println!();
    let _ = io::stdout().flush();
}

/// Percent-encode for query parameters (RFC 3986 "unreserved" left as-is).
fn encode_query_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Opens account chooser for `email`, then continues to Google App passwords.
fn gmail_app_password_setup_url(email: &str) -> String {
    const APP_PASSWORDS: &str = "https://myaccount.google.com/apppasswords";
    format!(
        "https://accounts.google.com/AccountChooser?Email={}&continue={}",
        encode_query_component(email.trim()),
        encode_query_component(APP_PASSWORDS),
    )
}

fn print_gmail_app_password_hint(email: &str) {
    println!("Gmail requires an app password (not your regular password).");
    println!(
        "An app password is a 16-character code that lets IMAP clients like ripmail access your mail without your main password."
    );
    println!();
    println!("  Enable 2-Step Verification (if you do not have it yet):");
    println!("    https://myaccount.google.com/signinoptions/two-step-verification");
    println!();
    println!("  Create or manage an app password for this address ({email}):");
    println!("    {}", gmail_app_password_setup_url(email));
    println!();
}

fn spinner(msg: &'static str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("{spinner:.cyan} {msg}")
            .unwrap(),
    );
    pb.set_message(msg);
    pb.enable_steady_tick(std::time::Duration::from_millis(80));
    pb
}

fn default_since_select_idx(existing: Option<&str>) -> usize {
    let default_since = existing.unwrap_or("1y");
    let valid: &[&str] = &["7d", "5w", "3m", "1y", "2y"];
    if valid.contains(&default_since) {
        SYNC_CHOICES
            .iter()
            .position(|c| c.value == default_since)
            .unwrap_or(3)
    } else {
        3
    }
}

fn prompt_email(default: &str) -> Result<String, Box<dyn std::error::Error>> {
    let email = InquireText::new("Email address")
        .with_default(default)
        .with_validator(|s: &str| {
            if s.trim().is_empty() {
                Ok(Validation::Invalid("Email address is required".into()))
            } else {
                Ok(Validation::Valid)
            }
        })
        .prompt()?;
    let email = email.trim().to_string();
    if email.is_empty() {
        return Err("Email address is required.".into());
    }
    Ok(email)
}

/// Returns (host, port).
fn prompt_imap_for_email(
    email: &str,
    host_default: &str,
    port_default: u16,
) -> Result<(String, u16), Box<dyn std::error::Error>> {
    let derived = derive_imap_settings(email);
    if let Some(ref d) = derived {
        let label = if d.host == "imap.gmail.com" {
            "Gmail"
        } else {
            "Provider"
        };
        println!("  → {label} detected ({}:{})\n", d.host, d.port);
    }

    if derived.is_some() {
        Ok((host_default.to_string(), port_default))
    } else {
        let host = InquireText::new("IMAP host")
            .with_default(host_default)
            .prompt()?;
        let port_s = InquireText::new("IMAP port")
            .with_default(&port_default.to_string())
            .prompt()?;
        let port: u16 = port_s.trim().parse().unwrap_or(port_default);
        Ok((host.trim().to_string(), port))
    }
}

fn prompt_imap_password(
    email: &str,
    existing_pw: Option<&str>,
    is_gmail_imap: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let password_value: String = if let Some(existing_pw) = existing_pw {
        let keep = format!("Keep existing password ({})", mask_secret(existing_pw));
        let enter = "Enter a new password";
        let choice = Select::new("IMAP password", vec![keep.clone(), enter.to_string()])
            .with_starting_cursor(0)
            .prompt()?;
        if choice == keep {
            existing_pw.to_string()
        } else {
            if is_gmail_imap {
                print_gmail_app_password_hint(email);
            }
            Password::new("IMAP app password")
                .without_confirmation()
                .with_display_mode(PasswordDisplayMode::Masked)
                .prompt()?
        }
    } else {
        if is_gmail_imap {
            print_gmail_app_password_hint(email);
        }
        Password::new("IMAP app password")
            .without_confirmation()
            .with_display_mode(PasswordDisplayMode::Masked)
            .prompt()?
    };

    if password_value.is_empty() {
        return Err("IMAP password is required.".into());
    }
    Ok(password_value)
}

fn prompt_openai_key(
    existing_key: Option<&str>,
    no_validate: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let api_key: String = if let Some(existing_key) = existing_key {
        let keep = format!("Keep existing key ({})", mask_secret(existing_key));
        let enter = "Enter a new API key";
        let choice = Select::new("OpenAI API key", vec![keep.clone(), enter.to_string()])
            .with_starting_cursor(0)
            .prompt()?;
        if choice == keep {
            existing_key.to_string()
        } else {
            println!("Get one at https://platform.openai.com/api-keys");
            Password::new("OpenAI API key")
                .without_confirmation()
                .with_display_mode(PasswordDisplayMode::Masked)
                .prompt()?
        }
    } else {
        println!("Get one at https://platform.openai.com/api-keys");
        Password::new("OpenAI API key")
            .without_confirmation()
            .with_display_mode(PasswordDisplayMode::Masked)
            .prompt()?
    };

    if api_key.trim().is_empty() {
        return Err("OpenAI API key is required.".into());
    }

    if !no_validate {
        let pb = spinner("Validating OpenAI API key…");
        let r = validate_openai_key(api_key.trim());
        pb.finish_and_clear();
        r.map_err(|_| {
            eprintln!("  Invalid API key. Check your key and try again.");
            "OpenAI validation failed".to_string()
        })?;
        println!("  API key valid");
    }
    Ok(api_key.trim().to_string())
}

fn validate_imap_smtp(
    opts: &WizardOptions,
    imap_host: &str,
    imap_port: u16,
    email: &str,
    password: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if opts.no_validate {
        return Ok(());
    }
    let pb = spinner("Connecting to IMAP…");
    let r = validate_imap_credentials(imap_host, imap_port, email, password);
    pb.finish_and_clear();
    r.inspect_err(|_| {
        eprintln!("  Could not connect. Check your credentials and try again.");
    })?;
    println!("  Connected to {imap_host} as {email}");

    let pb = spinner("Verifying SMTP…");
    let r = verify_smtp_credentials(imap_host, email, password);
    pb.finish_and_clear();
    r.map_err(|_| {
        eprintln!("  Could not verify SMTP. Check your credentials and try again.");
        "SMTP verification failed".to_string()
    })?;
    println!("  SMTP OK");
    Ok(())
}

/// Wizard always starts initial backfill in the background (detached subprocess).
fn spawn_wizard_background_sync(
    home: &Path,
    since: &str,
    mailbox: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("\nStarting sync in background (--since {since})...");
    let cfg = load_config(LoadConfigOptions {
        home: Some(home.to_path_buf()),
        env: None,
    });
    spawn_sync_background_detached(home, &cfg, Some(since), mailbox, false)?;
    println!("\nTry a search while it syncs:");
    println!("  ripmail search \"purchase or invoices\"");
    Ok(())
}

/// First-time setup when the user chooses Gmail / Google OAuth (browser sign-in).
fn wizard_gmail_oauth_path(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;

    let existing_env = load_existing_env_secrets(home);
    let existing_cfg = crate::setup::load_existing_wizard_config(home);

    let display_name =
        InquireText::new("How should ripmail sign your emails? (optional, press Enter to skip)")
            .with_default("")
            .prompt()?;
    let identity_patch = {
        let t = display_name.trim();
        if t.is_empty() {
            None
        } else {
            Some(IdentityPatch {
                preferred_name: Some(t.to_string()),
                ..Default::default()
            })
        }
    };

    write_google_oauth_setup(
        home,
        None,
        None,
        None,
        Some("imap.gmail.com"),
        Some(993),
        opts.no_validate,
        identity_patch.as_ref(),
    )?;

    if !opts.no_validate {
        let cfg = load_config(LoadConfigOptions {
            home: Some(home.clone()),
            env: None,
        });
        let pb = spinner("Verifying SMTP…");
        let r = verify_smtp_for_config(&cfg);
        pb.finish_and_clear();
        r.inspect_err(|_| {
            eprintln!("  Could not verify sending mail. Check your connection and try again.");
        })?;
        println!("  SMTP OK");
    }

    let api_key = prompt_openai_key(existing_env.api_key.as_deref(), opts.no_validate)?;
    merge_root_openai_key(home, Some(api_key.as_str()))?;

    let since = Select::new(
        "Default sync window (applies to refresh backfill)",
        SYNC_CHOICES.to_vec(),
    )
    .with_starting_cursor(default_since_select_idx(
        existing_cfg.default_since.as_deref(),
    ))
    .prompt()?;
    update_sync_default_since(home, since.value)?;

    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nConfig saved under {}/", home.display());

    spawn_wizard_background_sync(home, since.value, None)?;
    Ok(())
}

/// Run the interactive wizard (TTY required).
pub fn run_wizard(opts: WizardOptions) -> Result<(), Box<dyn std::error::Error>> {
    if !io::stdin().is_terminal() {
        eprintln!("{NON_TTY_MSG}");
        std::process::exit(1);
    }

    let home = &opts.home;
    std::fs::create_dir_all(home)?;

    if opts.clean {
        let has = crate::setup::ripmail_home_has_entries(home);
        if has {
            println!("{}", crate::setup::ripmail_clean_preview(home));
            println!();
            if !opts.yes {
                let proceed = Confirm::new("Delete everything above? This cannot be undone.")
                    .with_default(false)
                    .prompt()?;
                if !proceed {
                    println!("Cancelled.");
                    std::process::exit(0);
                }
            }
            crate::setup::clean_ripmail_home(home)?;
            println!("Done.\n");
        }
    }

    print_welcome_banner();

    let mut agent_skill_offered = false;
    if wizard_is_first_mailbox_setup(home) {
        println!("\nripmail wizard — let's get you connected.\n");
        println!("First mailbox — connect your primary account.\n");
        wizard_first_mailbox(&opts, &mut agent_skill_offered)?;
    } else {
        let n = load_mailbox_configs_for_wizard(home).len();
        println!("\nripmail wizard — manage your ripmail install.\n");
        println!("{n} mailbox(es) configured.\n");
        // Offer skill once after this menu unless the user exits immediately (first pick: Done).
        let exit_immediately = wizard_manage_install(&opts, &mut agent_skill_offered)?;
        if !exit_immediately {
            wizard_offer_agent_skill_install_once(&opts, &mut agent_skill_offered)?;
        }
    }
    println!();
    Ok(())
}

/// Offer the embedded `/ripmail` skill at most once per wizard session (before sync when applicable).
fn wizard_offer_agent_skill_install_once(
    opts: &WizardOptions,
    offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if *offered {
        return Ok(());
    }
    wizard_offer_agent_skill_install(opts)?;
    *offered = true;
    Ok(())
}

fn wizard_offer_agent_skill_install(
    _opts: &WizardOptions,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let has_openclaw = home.join(".openclaw/skills").is_dir();
    let can_claude = !skip_claude_skill_install();
    let can_openclaw = !skip_openclaw_skill_install() && has_openclaw;
    if !can_claude && !can_openclaw {
        return Ok(());
    }

    println!("\nAgent skill — `/ripmail` for Claude Code and compatible agents\n");

    let mut do_claude = false;
    if can_claude {
        let dest = claude_skill_dest().map_err(|e| e.to_string())?;
        let msg = format!("Install the ripmail skill at {}?", dest.display());
        do_claude = Confirm::new(&msg).with_default(true).prompt()?;
    }

    let mut do_openclaw = false;
    if can_openclaw {
        let dest = home.join(".openclaw/skills/ripmail");
        let msg = format!("Copy the ripmail skill to {} for OpenClaw?", dest.display());
        do_openclaw = Confirm::new(&msg).with_default(true).prompt()?;
    }

    if !do_claude && !do_openclaw {
        println!("Skipped agent skill install.");
        return Ok(());
    }

    match install_skill_from_embed_with_options(InstallSkillFromEmbedOptions {
        claude: do_claude,
        openclaw: do_openclaw,
        verbose: true,
    }) {
        Ok(()) => {}
        Err(e) => {
            eprintln!("Agent skill install failed: {e}");
            eprintln!("Try again later: ripmail skill install");
        }
    }
    Ok(())
}

/// Returns `true` when the user chose **Done** on the first inbox menu (no other wizard work).
/// Caller should skip a trailing agent-skill prompt in that case.
fn wizard_manage_install(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<bool, Box<dyn std::error::Error>> {
    let mut first_inbox_menu = true;
    loop {
        let mbs = load_mailbox_configs_for_wizard(opts.home.as_path());
        let mut choices: Vec<InboxMenuChoice> = mbs
            .into_iter()
            .map(|entry| {
                InboxMenuChoice::Mailbox(MailboxPick {
                    label: entry.email.clone(),
                    entry,
                })
            })
            .collect();
        choices.push(InboxMenuChoice::AddImap);
        #[cfg(target_os = "macos")]
        choices.push(InboxMenuChoice::AddAppleMail);
        choices.push(InboxMenuChoice::AddGmailOAuth);
        choices.push(InboxMenuChoice::Done);

        let picked = Select::new(
            "Choose an inbox (edit/delete), add one, or finish:",
            choices,
        )
        .prompt()?;

        match picked {
            InboxMenuChoice::Done => {
                println!("Goodbye.");
                return Ok(first_inbox_menu);
            }
            InboxMenuChoice::AddImap => wizard_add_mailbox_imap(opts, agent_skill_offered)?,
            InboxMenuChoice::AddAppleMail => {
                #[cfg(target_os = "macos")]
                wizard_add_mailbox_apple_mail(opts, agent_skill_offered)?;
                #[cfg(not(target_os = "macos"))]
                unreachable!("AddAppleMail is only in the menu on macOS")
            }
            InboxMenuChoice::AddGmailOAuth => {
                wizard_add_mailbox_gmail_oauth(opts, agent_skill_offered)?
            }
            InboxMenuChoice::Mailbox(pick) => {
                let action = Select::new(
                    &format!("{} — what would you like to do?", pick.label),
                    vec![
                        MailboxAction::Edit,
                        MailboxAction::Delete,
                        MailboxAction::Back,
                    ],
                )
                .prompt()?;
                match action {
                    MailboxAction::Back => {}
                    MailboxAction::Edit => {
                        wizard_edit_mailbox_for_entry(opts, pick.entry, agent_skill_offered)?;
                    }
                    MailboxAction::Delete => wizard_delete_mailbox(opts, &pick.entry)?,
                }
            }
        }
        first_inbox_menu = false;
    }
}

/// Auto-detect `~/Library/Mail/V*` and ensure the Envelope Index exists (no path prompt).
#[cfg(target_os = "macos")]
fn validate_apple_mail_envelope_index_auto_detect(
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    crate::applemail::validate_envelope_index_for_setup(None).map_err(|e| e.into())
}

/// Placeholder emails for Apple Mail–only wizard entries (`ripmail config` can set a real address later).
#[cfg(target_os = "macos")]
fn next_placeholder_applemail_email(mbs: &[MailboxConfigJson]) -> String {
    let n = mbs
        .iter()
        .filter(|m| m.mailbox_type.as_deref() == Some("applemail"))
        .count();
    if n == 0 {
        "applemail@local".into()
    } else {
        format!("applemail{}@local", n + 1)
    }
}

fn wizard_first_mailbox(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    let existing_env = load_existing_env_secrets(home);
    let existing_cfg = crate::setup::load_existing_wizard_config(home);

    #[cfg(target_os = "macos")]
    let connection = Select::new(
        "How do you want to connect?",
        vec![
            "Apple Mail — index mail already on this Mac".to_string(),
            "IMAP (any provider — email, server, and password)".to_string(),
            "Gmail — Sign in with Google (OAuth)".to_string(),
        ],
    )
    .with_starting_cursor(0)
    .prompt()?;

    #[cfg(not(target_os = "macos"))]
    let connection = Select::new(
        "How do you want to connect?",
        vec![
            "IMAP (any provider — email, server, and password)".to_string(),
            "Gmail — Sign in with Google (OAuth)".to_string(),
        ],
    )
    .with_starting_cursor(0)
    .prompt()?;

    #[cfg(target_os = "macos")]
    if connection.starts_with("Apple Mail") {
        return wizard_first_mailbox_apple_mail(opts, agent_skill_offered);
    }

    if connection.starts_with("Gmail") {
        return wizard_gmail_oauth_path(opts, agent_skill_offered);
    }

    let email = prompt_email(&existing_cfg.email.clone().unwrap_or_default())?;

    let derived = derive_imap_settings(&email);
    let host_default = existing_cfg
        .imap_host
        .clone()
        .or_else(|| derived.as_ref().map(|d| d.host.clone()))
        .unwrap_or_else(|| "imap.gmail.com".into());
    let port_default = existing_cfg
        .imap_port
        .or_else(|| derived.as_ref().map(|d| d.port))
        .unwrap_or(993);

    let (imap_host, imap_port) = prompt_imap_for_email(&email, &host_default, port_default)?;
    let is_gmail_imap = imap_host.eq_ignore_ascii_case("imap.gmail.com");

    let password_value =
        prompt_imap_password(&email, existing_env.password.as_deref(), is_gmail_imap)?;
    validate_imap_smtp(opts, &imap_host, imap_port, &email, &password_value)?;

    let api_key = prompt_openai_key(existing_env.api_key.as_deref(), opts.no_validate)?;

    let since = Select::new(
        "Default sync window (applies to refresh backfill)",
        SYNC_CHOICES.to_vec(),
    )
    .with_starting_cursor(default_since_select_idx(
        existing_cfg.default_since.as_deref(),
    ))
    .prompt()?;

    let display_name =
        InquireText::new("How should ripmail sign your emails? (optional, press Enter to skip)")
            .with_default("")
            .prompt()?;
    let identity_patch = {
        let t = display_name.trim();
        if t.is_empty() {
            None
        } else {
            Some(IdentityPatch {
                preferred_name: Some(t.to_string()),
                ..Default::default()
            })
        }
    };

    upsert_mailbox_setup(
        home,
        &email,
        &password_value,
        Some(api_key.as_str()),
        None,
        Some(imap_host.as_str()),
        Some(imap_port),
        Some(since.value),
        identity_patch.as_ref(),
    )?;

    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nConfig saved to {}/", home.display());

    spawn_wizard_background_sync(home, since.value, None)?;
    Ok(())
}

/// First-time setup: index from local Apple Mail (macOS only).
#[cfg(target_os = "macos")]
fn wizard_first_mailbox_apple_mail(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    let existing_cfg = crate::setup::load_existing_wizard_config(home);

    println!("\nripmail will index mail from the Mail app on this Mac.\n");
    println!(
        "If you see permission errors, grant Full Disk Access to the app running this terminal"
    );
    println!(
        "(Terminal, iTerm, Cursor, …): System Settings → Privacy & Security → Full Disk Access.\n"
    );

    let path_opt = validate_apple_mail_envelope_index_auto_detect()?;

    let since = existing_cfg
        .default_since
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("1y");

    const PLACEHOLDER_EMAIL: &str = "applemail@local";

    upsert_mailbox_applemail(
        home,
        PLACEHOLDER_EMAIL,
        None,
        None,
        path_opt.as_deref(),
        Some(since),
        None,
    )?;

    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nConfig saved to {}/", home.display());
    println!(
        "Tip: set your real email with `ripmail config` when you want send/compose identity.\n"
    );

    spawn_wizard_background_sync(home, since, Some(PLACEHOLDER_EMAIL))?;
    Ok(())
}

/// Add an Apple Mail–backed mailbox (macOS); same config path as `ripmail refresh` for `mailboxType: applemail`.
#[cfg(target_os = "macos")]
fn wizard_add_mailbox_apple_mail(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    println!("\nAdd mailbox (Apple Mail — local index)\n");

    let path_opt = validate_apple_mail_envelope_index_auto_detect()?;

    let existing_mbs = load_mailbox_configs_for_wizard(home);
    let email_trim = next_placeholder_applemail_email(&existing_mbs);
    let id_for_collision = derive_mailbox_id_from_email(&email_trim);
    if let Some(other) = existing_mbs.iter().find(|m| m.id == id_for_collision) {
        if other.email != email_trim {
            return Err(format!(
                "Another mailbox is already using the same storage location as this email ({other_email}). Pick a different email address.",
                other_email = other.email
            )
            .into());
        }
        return Err(format!("{email_trim} is already configured.").into());
    }
    if home.join(&id_for_collision).exists()
        && !existing_mbs.iter().any(|m| m.id == id_for_collision)
    {
        return Err(
            "A local mailbox folder for this email already exists but is not in your config. Remove the orphaned folder under your ripmail home directory, then try again."
                .into(),
        );
    }

    upsert_mailbox_applemail(
        home,
        &email_trim,
        None,
        None,
        path_opt.as_deref(),
        None,
        None,
    )?;

    if let Some(src) = existing_mbs.iter().find_map(|m| m.identity.as_ref()) {
        let mut cfg = load_config_json(home);
        if let Some(ref mut mbs) = cfg.mailboxes {
            if let Some(pos) = mbs.iter().position(|m| m.id == id_for_collision) {
                if mbs[pos].identity.is_none() {
                    mbs[pos].identity = Some(src.clone());
                    write_config_json(home, &cfg)?;
                    println!(
                        "  Copied your name and signature from another inbox; edit with `ripmail config` if needed."
                    );
                }
            }
        }
    }

    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nConfig saved.");

    let since = load_config(LoadConfigOptions {
        home: Some(home.clone()),
        env: None,
    })
    .sync_default_since
    .clone();

    spawn_wizard_background_sync(home, &since, Some(email_trim.as_str()))?;

    wizard_shared_settings(opts)?;
    Ok(())
}

/// After `write_google_oauth_setup` when adding a mailbox, verify SMTP and offer sync + shared settings.
fn finish_add_mailbox_after_google_oauth(
    opts: &WizardOptions,
    mailbox_id: &str,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    let cfg = load_config(LoadConfigOptions {
        home: Some(home.clone()),
        env: None,
    });
    let email = cfg
        .resolved_mailboxes
        .iter()
        .find(|m| m.id == mailbox_id)
        .map(|m| m.email.clone())
        .ok_or_else(|| "mailbox missing after OAuth setup".to_string())?;

    if !opts.no_validate {
        let pb = spinner("Verifying SMTP…");
        let r = verify_smtp_for_config(&cfg);
        pb.finish_and_clear();
        r.inspect_err(|_| {
            eprintln!("  Could not verify SMTP. Check OAuth tokens and try again.");
        })?;
        println!("  SMTP OK");
    }
    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nConfig saved.");
    let since = cfg.sync_default_since.clone();
    spawn_wizard_background_sync(home, &since, Some(email.as_str()))?;
    wizard_shared_settings(opts)?;
    Ok(())
}

fn wizard_add_mailbox_gmail_oauth(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    println!("\nAdd mailbox (Gmail — Sign in with Google)\n");

    let existing_mbs = load_mailbox_configs_for_wizard(home);
    let id = write_google_oauth_setup(
        home,
        None,
        None,
        None,
        Some("imap.gmail.com"),
        Some(993),
        opts.no_validate,
        None,
    )?;
    if let Some(src) = existing_mbs.iter().find_map(|m| m.identity.as_ref()) {
        let mut cfg = load_config_json(home);
        if let Some(ref mut mbs) = cfg.mailboxes {
            if let Some(pos) = mbs.iter().position(|m| m.id == id) {
                if mbs[pos].identity.is_none() {
                    mbs[pos].identity = Some(src.clone());
                    write_config_json(home, &cfg)?;
                    println!(
                        "  Copied your name and signature from another inbox; edit with `ripmail config` if needed."
                    );
                }
            }
        }
    }
    finish_add_mailbox_after_google_oauth(opts, &id, agent_skill_offered)
}

fn wizard_add_mailbox_imap(
    opts: &WizardOptions,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    println!("\nAdd mailbox (IMAP)\n");

    let email = prompt_email("")?;

    let derived = derive_imap_settings(&email);
    let host_default = derived
        .as_ref()
        .map(|d| d.host.clone())
        .unwrap_or_else(|| "imap.gmail.com".into());
    let port_default = derived.as_ref().map(|d| d.port).unwrap_or(993);

    let (imap_host, imap_port) = prompt_imap_for_email(&email, &host_default, port_default)?;
    let is_gmail_imap = imap_host.eq_ignore_ascii_case("imap.gmail.com");

    let id_for_collision = crate::config::derive_mailbox_id_from_email(&email);
    let existing_mbs = load_mailbox_configs_for_wizard(home);
    if let Some(other) = existing_mbs.iter().find(|m| m.id == id_for_collision) {
        if other.email != email {
            return Err(format!(
                "Another mailbox is already using the same storage location as this email ({other_email}). Pick a different email address.",
                other_email = other.email
            )
            .into());
        }
    }
    if home.join(&id_for_collision).join(".env").exists()
        && !existing_mbs.iter().any(|m| m.id == id_for_collision)
    {
        return Err(
            "A local mailbox folder for this email already exists but is not in your config. Remove the orphaned folder under your ripmail home directory, then try again."
                .into(),
        );
    }

    let password_value = prompt_imap_password(&email, None, is_gmail_imap)?;
    validate_imap_smtp(opts, &imap_host, imap_port, &email, &password_value)?;

    upsert_mailbox_setup(
        home,
        &email,
        &password_value,
        None,
        None,
        Some(imap_host.as_str()),
        Some(imap_port),
        None,
        None,
    )?;

    let new_id = derive_mailbox_id_from_email(&email);
    if let Some(src) = existing_mbs.iter().find_map(|m| m.identity.as_ref()) {
        let mut cfg = load_config_json(home);
        if let Some(ref mut mbs) = cfg.mailboxes {
            if let Some(pos) = mbs.iter().position(|m| m.id == new_id) {
                if mbs[pos].identity.is_none() {
                    mbs[pos].identity = Some(src.clone());
                    write_config_json(home, &cfg)?;
                    println!(
                        "  Copied your name and signature from another inbox; edit with `ripmail config` if needed."
                    );
                }
            }
        }
    }

    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nConfig saved.");

    let since = load_config(LoadConfigOptions {
        home: Some(home.clone()),
        env: None,
    })
    .sync_default_since
    .clone();

    spawn_wizard_background_sync(home, &since, Some(email.as_str()))?;

    wizard_shared_settings(opts)?;
    Ok(())
}

fn wizard_delete_mailbox(
    opts: &WizardOptions,
    entry: &MailboxConfigJson,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    println!("\nDelete mailbox\n");
    let proceed = Confirm::new(&format!(
        "Remove {} from ripmail and delete its local mailbox directory? \
Indexed messages for this account will be removed from the local database.",
        entry.email,
    ))
    .with_default(false)
    .prompt()?;
    if !proceed {
        println!("Cancelled.");
        return Ok(());
    }
    // Purge SQLite before updating config so `load_config` still resolves the same `db_path`
    // (multi-inbox uses `~/ripmail.db`; an empty `mailboxes` array switches to legacy paths).
    let cfg = load_config(LoadConfigOptions {
        home: Some(home.clone()),
        env: None,
    });
    let db_path = cfg.db_path().to_path_buf();
    if db_path.is_file() {
        match db::open_file(&db_path) {
            Ok(mut conn) => match db::purge_mailbox_from_index(&mut conn, &entry.id) {
                Ok(n) if n > 0 => {
                    println!("Removed {n} indexed message(s) from the database for this mailbox.");
                }
                Ok(_) => {}
                Err(e) => eprintln!("Warning: could not purge database rows for this mailbox: {e}"),
            },
            Err(e) => eprintln!("Warning: could not open database to purge mailbox rows: {e}"),
        }
    }
    remove_mailbox_from_config(home, &entry.id)?;
    let dir = home.join(&entry.id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    println!(
        "\nRemoved {} from config and deleted its local mailbox directory.",
        entry.email
    );
    Ok(())
}

fn wizard_edit_mailbox_for_entry(
    opts: &WizardOptions,
    entry: MailboxConfigJson,
    agent_skill_offered: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    println!("\nEdit mailbox\n");

    let mut entry = entry;
    let id = entry.id.clone();

    let new_email = InquireText::new("Email address")
        .with_default(&entry.email)
        .with_validator(|s: &str| {
            if s.trim().is_empty() {
                Ok(Validation::Invalid("Email address is required".into()))
            } else {
                Ok(Validation::Valid)
            }
        })
        .prompt()?;
    let new_email = new_email.trim().to_string();
    if new_email != entry.email {
        println!(
            "\nNote: changing the email updates IMAP login; local storage paths for this mailbox stay the same.\n"
        );
    }
    entry.email = new_email.clone();

    let derived = derive_imap_settings(&entry.email);
    let host_default = entry
        .imap
        .as_ref()
        .and_then(|i| i.host.clone())
        .or_else(|| derived.as_ref().map(|d| d.host.clone()))
        .unwrap_or_else(|| "imap.gmail.com".into());
    let port_default = entry
        .imap
        .as_ref()
        .and_then(|i| i.port)
        .or_else(|| derived.as_ref().map(|d| d.port))
        .unwrap_or(993);

    let (imap_host, imap_port) = prompt_imap_for_email(&entry.email, &host_default, port_default)?;
    entry.imap = Some(ImapJson {
        host: Some(imap_host.clone()),
        port: Some(imap_port),
        user: None,
        aliases: entry.imap.as_ref().and_then(|i| i.aliases.clone()),
        imap_auth: entry.imap.as_ref().and_then(|i| i.imap_auth.clone()),
    });

    let include_default = entry
        .search
        .as_ref()
        .and_then(|s| s.include_in_default)
        .unwrap_or(true);
    let yes = "Yes — include in default search";
    let no = "No — omit unless you pass --mailbox";
    let search_pick = Select::new(
        "Include this mailbox in default search?",
        vec![yes.to_string(), no.to_string()],
    )
    .with_starting_cursor(if include_default { 0 } else { 1 })
    .prompt()?;
    let include = search_pick == yes;
    entry.search = Some(MailboxSearchJson {
        include_in_default: Some(include),
    });

    let is_gmail_imap = imap_host.eq_ignore_ascii_case("imap.gmail.com");
    let existing_pw = load_imap_password_for_mailbox_id(home, &id);
    let password_value = prompt_imap_password(&entry.email, existing_pw.as_deref(), is_gmail_imap)?;

    validate_imap_smtp(opts, &imap_host, imap_port, &entry.email, &password_value)?;

    replace_mailbox_entry(home, entry.clone())?;
    let mb_dotenv = format!("RIPMAIL_IMAP_PASSWORD={password_value}\n");
    std::fs::write(home.join(&id).join(".env"), mb_dotenv)?;

    wizard_offer_agent_skill_install_once(opts, agent_skill_offered)?;
    println!("\nMailbox updated.");

    let since = load_config(LoadConfigOptions {
        home: Some(home.clone()),
        env: None,
    })
    .sync_default_since
    .clone();

    spawn_wizard_background_sync(home, &since, Some(entry.email.as_str()))?;

    wizard_shared_settings(opts)?;
    Ok(())
}

fn wizard_shared_settings(opts: &WizardOptions) -> Result<(), Box<dyn std::error::Error>> {
    let home = &opts.home;
    println!("\nShared settings — OpenAI and default sync window\n");

    let existing_env = load_existing_env_secrets(home);
    let existing_cfg = crate::setup::load_existing_wizard_config(home);

    let api_key = prompt_openai_key(existing_env.api_key.as_deref(), opts.no_validate)?;
    merge_root_openai_key(home, Some(api_key.as_str()))?;

    let since = Select::new(
        "Default sync window (for refresh --since backfill)",
        SYNC_CHOICES.to_vec(),
    )
    .with_starting_cursor(default_since_select_idx(
        existing_cfg.default_since.as_deref(),
    ))
    .prompt()?;

    update_sync_default_since(home, since.value)?;

    let enable_imap_archive = Confirm::new(
        "Enable IMAP archive? (ripmail archive will also move messages on the server)",
    )
    .with_default(existing_cfg.mailbox_management_enabled)
    .with_help_message("Requires mailboxManagement config; local-only archive is the default")
    .prompt()?;
    update_mailbox_management(home, enable_imap_archive)?;

    println!(
        "\nSaved shared settings to {}/config.json and {}/.env",
        home.display(),
        home.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{encode_query_component, gmail_app_password_setup_url};

    #[test]
    fn encode_query_component_encodes_at() {
        assert_eq!(encode_query_component("a@b.com"), "a%40b.com");
    }

    #[test]
    fn gmail_app_password_url_includes_email_and_continue() {
        let u = gmail_app_password_setup_url("user@gmail.com");
        assert!(u.starts_with("https://accounts.google.com/AccountChooser?"));
        assert!(u.contains("Email=user%40gmail.com"));
        assert!(u.contains("continue=https%3A%2F%2Fmyaccount.google.com%2Fapppasswords"));
    }
}
