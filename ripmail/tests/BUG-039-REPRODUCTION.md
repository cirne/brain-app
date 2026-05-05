# BUG-039 Reproduction Summary

## Bug Description
`ripmail archive` treats Message-IDs that start with a hyphen as CLI flags, causing parsing failures.

## Reproduction Steps

### 1. Unit Tests (Added to `ripmail/src/cli/args.rs`)
Five test cases demonstrate the bug at the CLI parsing level:
- `archive_leading_dash_message_id_fails_without_double_dash` - Confirms the bug
- `archive_leading_dash_message_id_works_with_double_dash` - Confirms workaround
- `archive_normal_message_id_works` - Confirms normal IDs work
- `archive_bracketed_leading_dash_message_id_fails` - Tests bracketed form
- `archive_multiple_message_ids_one_with_leading_dash` - Tests batch scenario

All tests pass, confirming the bug exists and the workaround functions.

### 2. Command-Line Reproduction

#### Bug Case
```bash
$ ripmail archive -OSgr@geopod-ismtpd-101
ripmail: note: unrecognized flag -O; ignoring
error: the following required arguments were not provided:
  <MESSAGE_IDS>...
```

**Analysis:** The `-O` at the start of the Message-ID is interpreted as a short flag by clap's argument parser.

#### Workaround
```bash
$ ripmail archive -- -OSgr@geopod-ismtpd-101
ripmail: set RIPMAIL_HOME or BRAIN_HOME to a non-empty path.
```

**Analysis:** Using `--` (end-of-options marker) prevents clap from treating subsequent arguments as flags. The error changed to a config error, confirming CLI parsing succeeded.

#### Normal Case
```bash
$ ripmail archive OSgr@geopod-ismtpd-101
ripmail: set RIPMAIL_HOME or BRAIN_HOME to a non-empty path.
```

**Analysis:** Message-IDs without leading hyphens parse correctly.

## Root Cause

In `ripmail/src/cli/args.rs`, the `Archive` command is defined as:

```rust
Archive {
    /// One or more RFC Message-IDs
    #[arg(required = true)]
    message_ids: Vec<String>,
    #[arg(long, short = 'S')]
    source: Option<String>,
    #[arg(long)]
    undo: bool,
},
```

The `message_ids` field is a **positional argument** without any special configuration. Clap's default behavior is to stop parsing flags when it encounters a positional argument, **unless** the argument looks like a flag (starts with `-`).

## Evidence

### Test Output
```
running 5 tests
test cli::args::archive_cli_tests::archive_leading_dash_message_id_works_with_double_dash ... ok
test cli::args::archive_cli_tests::archive_normal_message_id_works ... ok
test cli::args::archive_cli_tests::archive_bracketed_leading_dash_message_id_fails ... ok
test cli::args::archive_cli_tests::archive_multiple_message_ids_one_with_leading_dash ... ok
test cli::args::archive_cli_tests::archive_leading_dash_message_id_fails_without_double_dash ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 32 filtered out
```

### Script Output
See `ripmail/tests/bug_039_repro.sh` - all three test cases confirm:
1. ✓ BUG REPRODUCED: Leading dash parsed as flag
2. ✓ WORKAROUND SUCCESS: -- terminates flag parsing
3. ✓ NORMAL CASE: Message-ID without leading dash works

## Real-World Impact

DigitalOcean and potentially other email providers can generate Message-IDs with patterns like:
- `-OSgr@geopod-ismtpd-101`
- `-<alphanumeric>@<server>`

These are valid RFC 5322 Message-IDs but cannot be archived without the `--` workaround.

## Current Workaround

Users (including agents) must use `--` before message IDs:
```bash
ripmail archive -- -OSgr@geopod-ismtpd-101
```

## Suggested Fixes (from BUG-039.md)

1. **Require `--` end-of-options** before operands
2. **Add explicit `--message-id` / `-m` flag** (like `ripmail read` already supports via `message_id_flag`)
3. **Document quoting/escaping rules** for agents
4. Ensure consistency with other commands (e.g., `read`)

## Related Issues

The bug report mentions possible hardening parallels:
- BUG-029 (archived): `read` bare message ID without angle brackets
- BUG-044 (archived): `attachment list` ignores message-id flag
- OPP-087: unified sources § Message-IDs (normalize before lookup)

## Files Changed

1. `ripmail/src/cli/args.rs` - Added 5 unit tests for archive CLI parsing
2. `ripmail/tests/bug_039_repro.sh` - Shell script demonstrating the bug end-to-end

## Conclusion

**BUG-039 is successfully reproduced** at both the unit test level and command-line level. The bug is confirmed, the workaround is validated, and the root cause is identified in the CLI argument structure.
