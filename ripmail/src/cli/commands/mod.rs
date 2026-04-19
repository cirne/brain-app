mod archive;
mod assist;
mod calendar;
mod config;
mod mail;
mod rules;
mod setup;
mod skill;
mod sources;
mod sync;

use clap::CommandFactory;

use crate::cli::args::Commands;
use crate::cli::util::ripmail_home_path;
use crate::cli::CliResult;
use ripmail::setup::wizard_is_first_mailbox_setup;
use ripmail::{
    check_ripmail_home_access, migrate_legacy_zmail_home_dir_if_needed,
    resolved_ripmail_home_from_env,
};

pub(crate) fn handle_command(command: Option<Commands>) -> CliResult {
    let Some(home) = resolved_ripmail_home_from_env() else {
        eprintln!("ripmail: set RIPMAIL_HOME or BRAIN_HOME to a non-empty path.");
        std::process::exit(1);
    };
    if let Err(e) = check_ripmail_home_access(&home) {
        eprintln!("ripmail: {e}");
        std::process::exit(1);
    }
    migrate_legacy_zmail_home_dir_if_needed()?;
    let command = match command {
        None => {
            let home = ripmail_home_path();
            if wizard_is_first_mailbox_setup(&home) {
                print!(include_str!("../first_run_help.txt"), home.display());
                return Ok(());
            }
            let mut cmd = crate::cli::args::Cli::command();
            cmd.print_long_help()?;
            return Ok(());
        }
        Some(c) => c,
    };
    match command {
        Commands::Setup {
            email,
            password,
            google_oauth,
            apple_mail,
            apple_mail_path,
            openai_key,
            id,
            imap_host,
            imap_port,
            no_validate,
            no_skill,
            identity,
        } => setup::run_setup(
            email,
            password,
            google_oauth,
            apple_mail,
            apple_mail_path,
            openai_key,
            id,
            imap_host,
            imap_port,
            no_validate,
            no_skill,
            identity,
        ),
        Commands::Config {
            identity,
            id,
            email,
            mailbox_management,
        } => config::run_config(identity, id, email, mailbox_management),
        Commands::Skill { sub } => skill::run_skill(sub),
        Commands::Wizard {
            no_validate,
            clean,
            yes,
        } => setup::run_wizard_command(no_validate, clean, yes),
        Commands::Clean { yes } => setup::run_clean(yes),
        Commands::Refresh {
            duration,
            since,
            backfill,
            source,
            foreground,
            force,
            text,
            verbose,
        } => sync::run_update(
            duration, since, backfill, source, foreground, force, text, verbose,
        ),
        Commands::Status { json, imap } => sync::run_status(json, imap),
        Commands::Stats { json } => sync::run_stats(json),
        Commands::RebuildIndex => sync::run_rebuild_index(),
        Commands::Search {
            query,
            limit,
            from,
            to,
            subject,
            case_sensitive,
            after,
            since,
            before,
            source,
            include_all,
            category,
            text,
            json: _json,
            result_format,
            timings,
        } => mail::run_search(
            query,
            limit,
            from,
            to,
            subject,
            case_sensitive,
            after,
            since,
            before,
            source,
            include_all,
            category,
            text,
            result_format,
            timings,
        ),
        Commands::Who {
            query,
            limit,
            source,
            include_noreply,
            text,
        } => mail::run_who(query, limit, source, include_noreply, text),
        Commands::Whoami { source, text } => mail::run_whoami(source, text),
        Commands::Read {
            message_ids,
            source,
            raw,
            json,
            text: _text,
        } => mail::run_read(message_ids, source, raw, json),
        Commands::Thread {
            thread_id,
            json,
            text: _text,
        } => mail::run_thread(thread_id, json),
        Commands::Attachment { sub } => mail::run_attachment(sub),
        Commands::Send {
            draft_id,
            to,
            subject,
            body,
            cc,
            bcc,
            dry_run,
            source,
            text,
        } => mail::run_send(mail::SendCommandArgs {
            draft_id,
            to,
            subject,
            body,
            cc,
            bcc,
            dry_run,
            source,
            text,
        }),
        Commands::Draft { sub } => mail::run_draft(sub),
        Commands::Rules { sub, source } => rules::run_rules(sub, source),
        Commands::Sources { sub } => sources::run_sources(sub),
        Commands::Calendar { sub } => calendar::run_calendar(sub),
        Commands::Ask { question, verbose } => assist::run_ask(question, verbose),
        Commands::Inbox(args) => assist::run_inbox(args),
        Commands::Archive {
            message_ids,
            source,
            undo,
        } => archive::run_archive(message_ids, source, undo),
    }
}
