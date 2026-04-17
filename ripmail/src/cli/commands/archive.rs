use crate::cli::commands::mail::ensure_mail_source_only;
use crate::cli::util::load_cfg;
use crate::cli::CliResult;
use ripmail::{archive_messages_locally, db, message_id_for_json_output, provider_archive_message};

pub(crate) fn run_archive(
    message_ids: Vec<String>,
    source: Option<String>,
    undo: bool,
) -> CliResult {
    let cfg = load_cfg();
    if let Err(e) = ensure_mail_source_only(&cfg, source.as_deref()) {
        eprintln!("{e}");
        std::process::exit(1);
    }
    let conn = db::open_file(cfg.db_path())?;
    let archived = !undo;
    let mut results = Vec::new();
    for mid in &message_ids {
        let local_ok = archive_messages_locally(&conn, std::slice::from_ref(mid), archived)?;
        let provider = provider_archive_message(&cfg, &conn, mid, undo);
        results.push(serde_json::json!({
            "messageId": message_id_for_json_output(mid),
            "local": { "ok": local_ok > 0, "isArchived": archived },
            "providerMutation": provider,
        }));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({ "results": results }))?
    );
    Ok(())
}
