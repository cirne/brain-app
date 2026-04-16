# BUG-040: OAuth mailboxes — `draft` / `send` blocked by IMAP password gate — Agent-Reported

**Status:** Fixed (2026-04-06). **Created:** 2026-04-06. **Tags:** oauth, draft, send, smtp, gmail, agent-first

**Design lens:** [Agent-first](../../VISION.md) — users who complete `ripmail setup --google-oauth` expect the full read → draft → send loop.

**Reported context:** ztest feedback `bug-draft-fails-oauth-no-smtp-credentials.md`, session 2026-04-06. ripmail v0.1.2, macOS, Gmail OAuth (`imapAuth: "googleOAuth"`), ~11k messages synced; repro **always**.

---

## Resolution (2026-04-06)

- **`run_draft`** no longer gates on IMAP app password; local draft operations do not need SMTP credentials.
- **`run_send`** (`--to` / `--subject` path) uses **`smtp_credentials_ready`** ([`src/send/mod.rs`](../../../src/send/mod.rs)): app password vs Google OAuth token presence (`google-oauth.json` / mailbox `.env`), matching **`send_draft_by_id`**. CLI error text mentions OAuth vs app password.
- SMTP **XOAUTH2** for real sends was already implemented in [`send_simple_message`](../../../src/send/smtp_send.rs); the bug was the CLI-only password gate.
- Tests: [`tests/oauth_mailbox_draft_send_cli.rs`](../../../tests/oauth_mailbox_draft_send_cli.rs).

---

## Summary (historical)

- **Observed:** `ripmail draft new` failed with `IMAP user/password required. Run ripmail setup.` for Google OAuth mailboxes. Same config worked for `ripmail refresh` / `ripmail search`.
- **Expected:** Draft-only paths should not require app password; `ripmail send` should allow OAuth mailboxes (XOAUTH2).
- **Impact:** **P0 for OAuth onboarding:** blocked local drafts and send for `--google-oauth` users.

---

## What the agent did (and what happened)

```bash
ripmail draft new --to "a@b.com" --subject "Test" --body "Hello"
```

```text
IMAP user/password required. Run `ripmail setup`.
```

Example mailbox slice from config:

```json
{
  "id": "lewiscirne_gmail_com",
  "email": "lewiscirne@gmail.com",
  "imap": { "host": "imap.gmail.com", "port": 993, "user": null },
  "imapAuth": "googleOAuth",
  "smtp": null
}
```

---

## Root causes (resolved)

1. **CLI gate was password-only:** `run_draft` and `run_send` required non-empty `cfg.imap_password`. OAuth mailboxes intentionally have an empty merged password; the gate blocked them even though **`imap_user`** is filled from **`email`** in multi-mailbox config.
2. **Draft creation does not need SMTP:** The early exit was unnecessary coupling.

---

## References

- Vision (agent-first): [VISION.md](../../VISION.md)
- Outbound architecture: [ADR-024](../../ARCHITECTURE.md#adr-024-outbound-email--smtp-send-as-user--local-drafts)
- OAuth workstream: [OPP-042](../../opportunities/OPP-042-google-oauth-cli-auth.md), [PLAN-OPP-042](../../plans/PLAN-OPP-042-google-oauth-cli.md)
- Prior draft/send friction: [BUG-027 archived](BUG-027-rust-draft-cli-errors-and-stdin-hang.md), [BUG-031 archived](BUG-031-send-reply-draft-wrong-maildir-path.md)
