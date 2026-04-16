# BUG-056: Wizard Exits on Bad IMAP Password Instead of Retrying

**Status:** Open. **Created:** 2026-04-14. **Tags:** wizard, imap, ux, credentials

---

## Symptom

When the user enters a wrong IMAP app password in `ripmail wizard`, the wizard prints an error and **exits to the shell** instead of looping back to the password prompt.

```
> IMAP app password ********
  Could not connect. Check your credentials and try again.
Error: "IMAP: No Response: [AUTHENTICATIONFAILED] Invalid credentials (Failure)"
```

The user has to re-run `ripmail wizard` from scratch, losing any other in-progress input.

## Expected Behavior

After a failed credential check the wizard should stay in the flow and re-prompt for the password (and optionally the email address), allowing the user to correct the typo without restarting.

## Affected Flow

- `ripmail wizard` → first-time setup (or add mailbox) → IMAP app-password entry
- Same likely applies to the email field if a bad address is provided before the password check

## Location

`src/wizard/mod.rs` — the credential-validation step that calls `validate_imap` (or equivalent); currently propagates the error upward and exits instead of catching it and looping.

## Fix Sketch

Wrap the IMAP connection test in a loop; on failure print the "Could not connect" message and re-prompt for the password (keep the email pre-filled). After N consecutive failures (e.g. 3) offer the option to skip validation or abort.
