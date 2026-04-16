//! Retry CLI parsing after stripping unrecognized flags (agent-friendly).

use std::ffi::OsString;

use clap::error::{ContextKind, ContextValue, ErrorKind};
use clap::Parser;

use super::args::Cli;

const MAX_UNKNOWN_FLAG_STRIPS: usize = 64;

/// `ripmail draft --instruction ...` is invalid (`--instruction` belongs on a subcommand); the forgiving
/// parser would otherwise strip `--instruction` and fail with a confusing "unrecognized subcommand".
pub(crate) fn hint_draft_instruction_misplaced(argv: &[OsString]) -> Option<&'static str> {
    if argv.len() < 3 {
        return None;
    }
    if argv[1].to_string_lossy() != "draft" {
        return None;
    }
    let t2 = argv[2].to_string_lossy();
    if t2 == "--instruction" || t2.starts_with("--instruction=") {
        return Some(
            "`--instruction` must come after a draft subcommand (`draft new`, `draft reply`, `draft forward`, …). Examples: `ripmail draft new --to addr@example.com --instruction \"...\"`, `ripmail draft reply --message-id '<id>' --instruction \"...\"`. For an existing draft, use `ripmail draft edit <id> <instruction>`.",
        );
    }
    None
}

fn invalid_arg_token(err: &clap::Error) -> Option<String> {
    match err.get(ContextKind::InvalidArg)? {
        ContextValue::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// Remove one argv token matching clap's unknown-flag token (long, `--k=v`, exact short, or short cluster).
fn strip_matching_arg(args: &mut Vec<OsString>, invalid: &str) -> bool {
    if invalid.is_empty() {
        return false;
    }

    if let Some(i) = args.iter().position(|a| a.to_string_lossy() == invalid) {
        args.remove(i);
        return true;
    }

    if invalid.starts_with("--") && !invalid.contains('=') {
        let prefix = format!("{invalid}=");
        if let Some(i) = args
            .iter()
            .position(|a| a.to_string_lossy().starts_with(&prefix))
        {
            args.remove(i);
            return true;
        }
    }

    if let Some(bad) = invalid
        .strip_prefix('-')
        .filter(|s| s.len() == 1)
        .and_then(|s| s.chars().next())
        .filter(|_| !invalid.starts_with("--"))
    {
        for i in 1..args.len() {
            let t = args[i].to_string_lossy();
            if t == invalid {
                args.remove(i);
                return true;
            }
            if t.starts_with("--") || !t.starts_with('-') || t.len() <= 1 {
                continue;
            }
            let rest: Vec<char> = t.chars().skip(1).collect();
            if let Some(pos) = rest.iter().position(|&c| c == bad) {
                let mut new_rest = rest;
                new_rest.remove(pos);
                if new_rest.is_empty() {
                    args.remove(i);
                } else {
                    args[i] = OsString::from(format!("-{}", new_rest.iter().collect::<String>()));
                }
                return true;
            }
        }
    }

    false
}

pub(crate) fn parse_cli_forgiving(
    mut args: Vec<OsString>,
) -> Result<(Cli, Vec<String>), (Vec<String>, clap::Error)> {
    let mut notes: Vec<String> = Vec::new();

    for _ in 0..MAX_UNKNOWN_FLAG_STRIPS {
        match Cli::try_parse_from(&args) {
            Ok(cli) => return Ok((cli, notes)),
            Err(e) => {
                if e.kind() == ErrorKind::UnknownArgument {
                    if let Some(token) = invalid_arg_token(&e) {
                        if strip_matching_arg(&mut args, &token) {
                            let silent =
                                token == "--json" || token == "-j" || token.starts_with("--json=");
                            if !silent {
                                notes.push(format!("unrecognized flag {token}; ignoring"));
                            }
                            continue;
                        }
                    }
                }
                return Err((notes, e));
            }
        }
    }

    Err((
        notes,
        clap::Error::raw(ErrorKind::UnknownArgument, "too many unrecognized flags"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::args::Commands;
    use ripmail::draft::DraftCmd;

    #[test]
    fn forgiving_strips_and_parses_draft_list() {
        let args = vec![
            OsString::from("ripmail"),
            OsString::from("draft"),
            OsString::from("list"),
            OsString::from("--superfluous"),
        ];
        let (cli, notes) = parse_cli_forgiving(args).expect("parse");
        assert_eq!(notes.len(), 1);
        match cli.command {
            Some(Commands::Draft { sub }) => match sub {
                DraftCmd::List { .. } => {}
                _ => panic!("expected draft list"),
            },
            Some(_) => panic!("wrong command"),
            None => panic!("expected command"),
        }
    }

    #[test]
    fn strip_long_exact() {
        let mut a = vec![
            OsString::from("ripmail"),
            OsString::from("draft"),
            OsString::from("list"),
            OsString::from("--bogus"),
        ];
        assert!(strip_matching_arg(&mut a, "--bogus"));
        assert_eq!(
            a,
            vec![
                OsString::from("ripmail"),
                OsString::from("draft"),
                OsString::from("list"),
            ]
        );
    }

    #[test]
    fn strip_long_equals_form() {
        let mut a = vec![
            OsString::from("ripmail"),
            OsString::from("search"),
            OsString::from("q"),
            OsString::from("--bogus=1"),
        ];
        assert!(strip_matching_arg(&mut a, "--bogus"));
        assert_eq!(
            a,
            vec![
                OsString::from("ripmail"),
                OsString::from("search"),
                OsString::from("q"),
            ]
        );
    }

    #[test]
    fn forgiving_inbox_json_flag_no_note_when_defined_on_command() {
        let args = vec![
            OsString::from("ripmail"),
            OsString::from("inbox"),
            OsString::from("24h"),
            OsString::from("--json"),
        ];
        let (_cli, notes) = parse_cli_forgiving(args).expect("parse");
        assert!(notes.is_empty(), "unexpected notes: {notes:?}");
    }

    #[test]
    fn hint_draft_instruction_without_new() {
        let a = vec![
            OsString::from("ripmail"),
            OsString::from("draft"),
            OsString::from("--instruction"),
            OsString::from("foo"),
        ];
        assert!(hint_draft_instruction_misplaced(&a).is_some());
    }

    #[test]
    fn hint_draft_instruction_equals_form() {
        let a = vec![
            OsString::from("ripmail"),
            OsString::from("draft"),
            OsString::from("--instruction=foo"),
        ];
        assert!(hint_draft_instruction_misplaced(&a).is_some());
    }

    #[test]
    fn no_hint_when_draft_new_has_instruction() {
        let a = vec![
            OsString::from("ripmail"),
            OsString::from("draft"),
            OsString::from("new"),
            OsString::from("--to"),
            OsString::from("x@y.com"),
            OsString::from("--instruction"),
            OsString::from("hi"),
        ];
        assert!(hint_draft_instruction_misplaced(&a).is_none());
    }

    #[test]
    fn strip_short_cluster() {
        let mut a = vec![
            OsString::from("ripmail"),
            OsString::from("status"),
            OsString::from("-xj"),
        ];
        assert!(strip_matching_arg(&mut a, "-j"));
        assert_eq!(
            a,
            vec![
                OsString::from("ripmail"),
                OsString::from("status"),
                OsString::from("-x"),
            ]
        );
    }
}
