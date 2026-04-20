use std::collections::HashMap;
use std::io::Write;

use crate::cli::args::SETUP_CMD_AFTER_LONG_HELP;
use crate::cli::identity_args::{identity_args_nonempty, IdentityArgs};
use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::{
    clean_ripmail_home, install_skill_from_embed, resolve_openai_api_key, resolve_setup_email,
    resolve_setup_password, ripmail_clean_preview, ripmail_home_has_entries, run_wizard,
    validate_envelope_index_for_setup, validate_imap_credentials, validate_openai_key,
    verify_smtp_for_config, write_applemail_setup, write_google_oauth_setup, write_setup,
    LoadConfigOptions, SetupArgs, WizardOptions,
};

fn print_setup_help_when_missing_creds() {
    println!();
    println!("Usage: ripmail setup [OPTIONS]");
    println!();
    println!("{}", SETUP_CMD_AFTER_LONG_HELP.trim());
    println!();
    println!("Full flag list: ripmail setup --help");
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_setup(
    email: Option<String>,
    password: Option<String>,
    google_oauth: bool,
    apple_mail: bool,
    apple_mail_path: Option<String>,
    openai_key: Option<String>,
    mailbox_id: Option<String>,
    imap_host: Option<String>,
    imap_port: Option<u16>,
    no_validate: bool,
    no_skill: bool,
    identity: IdentityArgs,
) -> CliResult {
    let home = ripmail_home_path();
    let env_map: HashMap<String, String> = std::env::vars().collect();

    let identity_patch = identity.to_patch();
    let args = SetupArgs {
        email,
        password,
        openai_key: openai_key.clone(),
        mailbox_id,
        imap_host,
        imap_port,
        no_validate,
        identity_patch,
    };

    if apple_mail {
        if !cfg!(target_os = "macos") {
            eprintln!("ripmail setup: --apple-mail requires macOS.");
            std::process::exit(1);
        }

        let email =
            resolve_setup_email(&args, &env_map).unwrap_or_else(|| "applemail@local".to_string());

        let path_for_config = match validate_envelope_index_for_setup(apple_mail_path.as_deref()) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("ripmail setup: {e}");
                std::process::exit(1);
            }
        };

        let id = match write_applemail_setup(
            &home,
            &email,
            openai_key.as_deref(),
            args.mailbox_id.as_deref(),
            path_for_config.as_deref(),
            args.identity_patch.as_ref(),
        ) {
            Ok(id) => id,
            Err(e) => {
                eprintln!("ripmail setup: {e}");
                std::process::exit(1);
            }
        };

        if !no_validate {
            if let Some(api_key) = resolve_openai_api_key(&LoadConfigOptions {
                home: Some(home.clone()),
                env: None,
            }) {
                print!("Validating OpenAI API key... ");
                std::io::stdout().flush().ok();
                if validate_openai_key(&api_key).is_err() {
                    println!("Failed");
                    eprintln!("Invalid API key.");
                    std::process::exit(1);
                }
                println!("OK");
            }
        }

        #[cfg(target_os = "macos")]
        ripmail::calendar::apple_sqlite::warn_calendar_db_read_access();

        let cfg = load_cfg();
        println!("Wrote config under {} (mailbox id: {id})", home.display());
        println!(
            "Tip: ripmail backfill --foreground --source {} --since {}",
            email, cfg.sync_default_since
        );
        if !no_skill {
            if let Err(e) = install_skill_from_embed(true) {
                eprintln!("Note: could not install agent skill: {e}");
            }
        }
        return Ok(());
    }

    let Some(email) = resolve_setup_email(&args, &env_map) else {
        eprintln!("ripmail setup: account email required (`--email` or `RIPMAIL_EMAIL`).");
        eprintln!("Interactive setup: `ripmail wizard`");
        if identity_args_nonempty(&identity) {
            eprintln!(
                "To update your name or signature without running full setup, use `ripmail config` with the same identity flags."
            );
        }
        print_setup_help_when_missing_creds();
        return Ok(());
    };

    if google_oauth {
        let id = write_google_oauth_setup(
            &home,
            Some(email.as_str()),
            openai_key.as_deref(),
            args.mailbox_id.as_deref(),
            args.imap_host.as_deref(),
            args.imap_port,
            no_validate,
            args.identity_patch.as_ref(),
        )?;
        if !no_validate {
            let cfg = load_cfg();
            print!("Validating SMTP... ");
            std::io::stdout().flush().ok();
            if verify_smtp_for_config(&cfg).is_err() {
                println!("Failed");
                eprintln!("Could not verify SMTP. Check OAuth tokens and network.");
                std::process::exit(1);
            }
            println!("OK");
            let Some(api_key) = resolve_openai_api_key(&LoadConfigOptions {
                home: Some(home.clone()),
                env: None,
            }) else {
                println!("Failed");
                eprintln!("OpenAI API key missing after setup.");
                std::process::exit(1);
            };
            print!("Validating OpenAI API key... ");
            std::io::stdout().flush().ok();
            if validate_openai_key(&api_key).is_err() {
                println!("Failed");
                eprintln!("Invalid API key.");
                std::process::exit(1);
            }
            println!("OK");
        }
        let cfg = load_cfg();
        println!("Wrote config under {} (mailbox id: {id})", home.display());
        println!(
            "Tip: ripmail backfill --source {} --since {}",
            email, cfg.sync_default_since
        );
        if !no_skill {
            if let Err(e) = install_skill_from_embed(true) {
                eprintln!("Note: could not install agent skill: {e}");
            }
        }
        return Ok(());
    }

    let Some(password) = resolve_setup_password(&args, &env_map) else {
        eprintln!("ripmail setup: IMAP password required (`--password` or `RIPMAIL_IMAP_PASSWORD`), or use `--google-oauth`.");
        if identity_args_nonempty(&identity) && home.join("config.json").is_file() {
            eprintln!(
                "You already have a config. To change your name or signature without re-entering credentials, run `ripmail config` with the same identity flags (see `ripmail config --help`)."
            );
        }
        print_setup_help_when_missing_creds();
        return Ok(());
    };

    let id = write_setup(
        &home,
        &email,
        &password,
        openai_key.as_deref(),
        args.mailbox_id.as_deref(),
        args.imap_host.as_deref(),
        args.imap_port,
        args.identity_patch.as_ref(),
    )?;
    if !no_validate {
        let cfg = load_cfg();

        print!("Validating IMAP... ");
        std::io::stdout().flush().ok();
        if validate_imap_credentials(
            &cfg.imap_host,
            cfg.imap_port,
            &cfg.imap_user,
            &cfg.imap_password,
        )
        .is_err()
        {
            println!("Failed");
            eprintln!("Could not connect to IMAP. Check your credentials.");
            std::process::exit(1);
        }
        println!("OK");

        print!("Validating SMTP... ");
        std::io::stdout().flush().ok();
        if verify_smtp_for_config(&cfg).is_err() {
            println!("Failed");
            eprintln!("Could not verify SMTP. Check your credentials and network.");
            std::process::exit(1);
        }
        println!("OK");

        let Some(api_key) = resolve_openai_api_key(&LoadConfigOptions {
            home: Some(home.clone()),
            env: None,
        }) else {
            println!("Failed");
            eprintln!("OpenAI API key missing after setup.");
            std::process::exit(1);
        };

        print!("Validating OpenAI API key... ");
        std::io::stdout().flush().ok();
        if validate_openai_key(&api_key).is_err() {
            println!("Failed");
            eprintln!("Invalid API key.");
            std::process::exit(1);
        }
        println!("OK");
    }

    let cfg = load_cfg();
    println!("Wrote config under {} (mailbox id: {id})", home.display());
    println!(
        "Tip: ripmail backfill --source {} --since {}",
        email, cfg.sync_default_since
    );
    if !no_skill {
        if let Err(e) = install_skill_from_embed(true) {
            eprintln!("Note: could not install agent skill: {e}");
        }
    }
    Ok(())
}

pub(crate) fn run_wizard_command(no_validate: bool, clean: bool, yes: bool) -> CliResult {
    run_wizard(WizardOptions {
        home: ripmail_home_path(),
        no_validate,
        clean,
        yes,
    })?;
    Ok(())
}

pub(crate) fn run_clean(yes: bool) -> CliResult {
    let home = ripmail_home_path();
    if !home.exists() {
        if yes {
            println!("Nothing to remove — {} does not exist.", home.display());
        } else {
            println!("Nothing to clean — {} does not exist.", home.display());
        }
        return Ok(());
    }
    if !ripmail_home_has_entries(&home) {
        println!("{} is empty — nothing to remove.", home.display());
        return Ok(());
    }
    if !yes {
        println!("{}", ripmail_clean_preview(&home));
        println!();
        println!("To erase everything above, run: ripmail clean --yes");
        return Ok(());
    }
    println!("{}", ripmail_clean_preview(&home));
    println!();
    clean_ripmail_home(&home)?;
    println!("Removed all ripmail data under {}.", home.display());
    Ok(())
}
