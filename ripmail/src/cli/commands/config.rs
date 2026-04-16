//! `ripmail config` — merge non-secret settings into existing config.json.

use crate::cli::identity_args::IdentityArgs;
use crate::cli::util::ripmail_home_path;
use crate::cli::CliResult;
use ripmail::{
    load_config_json, resolve_config_target_mailbox_id, update_mailbox_identity,
    update_mailbox_management,
};

pub(crate) fn run_config(
    identity: IdentityArgs,
    id: Option<String>,
    email: Option<String>,
    mailbox_management: Option<bool>,
) -> CliResult {
    let home = ripmail_home_path();
    let cfg_path = home.join("config.json");
    if !cfg_path.is_file() {
        eprintln!(
            "ripmail config: no config at {}. Run `ripmail setup --email ...` (or `ripmail wizard`) first.",
            cfg_path.display()
        );
        std::process::exit(1);
    }

    let identity_patch = identity.to_patch();
    let has_identity = identity_patch.is_some();
    let has_mgmt = mailbox_management.is_some();

    if !has_identity && !has_mgmt {
        eprintln!(
            "ripmail config: pass at least one of: `--preferred-name`, `--full-name`, `--signature`, `--signature-id`, or `--mailbox-management`."
        );
        eprintln!("Run `ripmail config --help` for examples.");
        std::process::exit(1);
    }

    if let Some(ref patch) = identity_patch {
        let mailbox_id = resolve_config_target_mailbox_id(&home, id.as_deref(), email.as_deref())
            .unwrap_or_else(|e| {
                eprintln!("ripmail config: {e}");
                std::process::exit(1);
            });
        update_mailbox_identity(&home, &mailbox_id, patch).unwrap_or_else(|e| {
            eprintln!("ripmail config: {e}");
            std::process::exit(1);
        });
        println!(
            "Updated identity for mailbox id `{mailbox_id}` in {}.",
            cfg_path.display()
        );
    }

    if let Some(enabled) = mailbox_management {
        update_mailbox_management(&home, enabled)?;
        println!(
            "mailboxManagement.enabled = {enabled} (merged into {}).",
            cfg_path.display()
        );
    }

    // Sanity: config still parses
    let _ = load_config_json(&home);
    Ok(())
}
