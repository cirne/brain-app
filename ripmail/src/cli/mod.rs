mod args;
mod commands;
mod forgiving;
mod identity_args;
mod triage;
mod util;

use std::ffi::OsString;

use clap::error::{ContextKind, ContextValue, ErrorKind};
use clap::CommandFactory;

pub(crate) type CliResult = Result<(), Box<dyn std::error::Error>>;

/// Valid subcommand names along argv until the first unknown token (exclusive), for the same tree as `Cli::command()`.
fn known_subcommand_prefix(cmd: &clap::Command, argv: &[OsString]) -> Vec<String> {
    let mut cur = cmd;
    let mut out = Vec::new();
    let mut i = 1;
    while i < argv.len() {
        let token = argv[i].to_string_lossy();
        if token.starts_with('-') {
            i += 1;
            continue;
        }
        match cur.find_subcommand(token.as_ref()) {
            Some(next) => {
                out.push(token.into_owned());
                cur = next;
                i += 1;
            }
            None => break,
        }
    }
    out
}

fn subcommand_mut_at_path<'a>(
    root: &'a mut clap::Command,
    path: &[String],
) -> &'a mut clap::Command {
    let mut cur = root;
    for name in path {
        cur = cur
            .find_subcommand_mut(name.as_str())
            .expect("path from known_subcommand_prefix must exist on fresh Cli::command()");
    }
    cur
}

pub(crate) fn run() -> CliResult {
    let args: Vec<OsString> = std::env::args_os().collect();
    if let Some(msg) = forgiving::hint_draft_instruction_misplaced(&args) {
        eprintln!("error: {msg}");
        eprintln!(
            "From the repo root, run the current sources with: cargo run -- draft new --to <addr> --instruction \"...\""
        );
        std::process::exit(2);
    }
    let (cli, notes) = match forgiving::parse_cli_forgiving(args.clone()) {
        Ok(v) => v,
        Err((notes, e)) => {
            for n in notes {
                eprintln!("ripmail: note: {n}");
            }
            if e.kind() == ErrorKind::InvalidSubcommand {
                if let Some(ContextValue::String(name)) = e.get(ContextKind::InvalidSubcommand) {
                    eprintln!("error: unrecognized subcommand '{name}'");
                } else {
                    let _ = e.print();
                }
                let probe = args::Cli::command();
                let prefix = known_subcommand_prefix(&probe, &args);
                let mut cmd = args::Cli::command();
                let target = subcommand_mut_at_path(&mut cmd, &prefix);
                let _ = target.print_long_help();
                std::process::exit(e.exit_code());
            }
            e.exit();
        }
    };
    for n in notes {
        eprintln!("ripmail: note: {n}");
    }

    commands::handle_command(cli)
}

#[cfg(test)]
mod bare_cli_tests {
    use super::args::Cli;
    use clap::Parser;

    #[test]
    fn bare_ripmail_parses_as_no_subcommand() {
        let cli = Cli::try_parse_from(["ripmail"]).expect("parse");
        assert!(cli.command.is_none());
    }
}
