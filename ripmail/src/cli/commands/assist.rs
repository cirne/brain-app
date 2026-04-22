use crate::cli::args::InboxArgs;
use crate::cli::commands::mail::ensure_mail_source_only;
use crate::cli::triage::run_triage_command;
use crate::cli::util::load_cfg;
use crate::cli::CliResult;
use ripmail::{db, resolve_llm, run_ask as run_ask_query, LoadConfigOptions, RunAskOptions};

pub(crate) fn run_ask(mut question: Vec<String>, verbose: bool) -> CliResult {
    let cfg = load_cfg();
    if question.first().is_some_and(|s| s == "--") {
        question.remove(0);
    }

    let question = question.join(" ");
    let question = question.trim();
    if question.is_empty() {
        eprintln!("Usage: ripmail ask <question> [--verbose]");
        eprintln!(
            "  Answer a question about your email using an internal agent (requires LLM credentials; see AGENTS.md)."
        );
        eprintln!();
        eprintln!("Example: ripmail ask \"summarize my tech news this week\"");
        eprintln!(
            "  Use --verbose (or -v) to log pipeline progress (phase 1, context assembly, etc.)."
        );
        std::process::exit(1);
    }

    let llm_opts = LoadConfigOptions {
        home: ripmail::resolved_ripmail_home_from_env(),
        env: None,
    };
    let llm = match resolve_llm(&llm_opts) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("ripmail ask: {e}");
            eprintln!("Configure $RIPMAIL_HOME/config.json \"llm\" and env vars (see AGENTS.md).");
            std::process::exit(1);
        }
    };

    let conn = db::open_file_for_queries(cfg.db_path())?;
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(run_ask_query(
        question,
        &conn,
        cfg.message_path_root(),
        &cfg.imap_user,
        cfg.attachments_cache_extracted_text,
        &llm,
        RunAskOptions {
            stream: true,
            verbose,
        },
    ))?;
    Ok(())
}

pub(crate) fn run_inbox(args: InboxArgs) -> CliResult {
    let cfg = load_cfg();
    if let Err(e) = ensure_mail_source_only(&cfg, args.source.as_deref()) {
        eprintln!("{e}");
        std::process::exit(1);
    }
    run_triage_command(&cfg, &args)
}
