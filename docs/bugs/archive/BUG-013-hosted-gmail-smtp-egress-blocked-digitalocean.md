# BUG-013: Hosted Brain cannot send mail via `ripmail send` (Gmail SMTP) — DigitalOcean blocks outbound 587/465/25; fix likely Gmail API over HTTPS

**Status: fixed (2026-04-22).** Outbound send for **Gmail + OAuth** now uses the **Gmail API** on **HTTPS 443** (`users.messages.send` to `gmail.googleapis.com`) instead of SMTP to `smtp.gmail.com:587`, so hosted environments (e.g. DigitalOcean) where ports 25/465/587 are blocked can still send as the user. Implementation: [`ripmail/src/send/gmail_api_send.rs`](../../../ripmail/src/send/gmail_api_send.rs), routing in [`ripmail/src/send/smtp_send.rs`](../../../ripmail/src/send/smtp_send.rs) (`should_send_via_gmail_api`). Non-Gmail and app-password paths may still use lettre/SMTP where the network allows.

## Severity (historical)

**High** — at time of report, core product flow (send draft from the user’s **own Gmail** in hosted/staging) failed with long hangs or non‑zero exit; local dev on `localhost:3000` (no platform SMTP block) worked.

## Status (at time of report)

**Was: Open** — root cause was **outbound transport**, not Google OAuth. **Resolution:** product now sends through **Gmail’s HTTP API** with existing user OAuth, not **`smtp.gmail.com:587`**, for the hosted Gmail+OAuth case.

## Summary

On **DigitalOcean Droplets** (e.g. **braintunnel staging**), outbound **SMTP to `smtp.gmail.com:587`** did not complete: TCP **times out** from the host. The Brain server uses **ripmail** (`ripmail send …`) for agent **`send_draft`** and **`POST /api/inbox/draft/:id/send`**, which authenticates to Gmail and previously used **Lettre** to call **`transport.send(&email)`** to **`smtp.gmail.com:587`**. **OAuth and token refresh work** (HTTPS to Google), but **submitted email** over SMTP never got a live socket on DO.

This is **not** “Gmail only allows home broadband clients.” [DigitalOcean documents](https://docs.digitalocean.com/support/why-is-smtp-blocked/) a **default platform block** on Droplets for outbound **25, 465, and 587** to reduce abuse. That matches a plain **`nc -vz smtp.gmail.com 587`** test showing **connect timeout** on IPv4 and **unreachable** IPv6, while the **Cloud Firewall** in use allows broad outbound TCP.

**Transactional providers (e.g. SendGrid)** are **not** a drop‑in fix when the requirement is to send **as the user’s own Gmail** using their existing sign‑in. The fix is **send via Google’s API** (same user consent / refresh token family), e.g. **`users.messages.send`**, over **HTTPS (443)**, which **is** allowed from typical hosting.

## Environment

- **Failing:** Hosted staging, Docker on **DO Droplet** (`braintunnel-staging`, e.g. `nyc1`), path to **`smtp.gmail.com:587`** blocked at **TCP** (timeout).
- **Working:** **Local** dev (no DO Droplet / no platform SMTP block), `localhost:3000` — **`ripmail send`** over SMTP could complete.
- **OAuth:** Google Cloud project has e.g. **Web** (“Brain App”) and **Desktop** (“ripmail-cli”) clients; IMAP + OAuth can succeed in both contexts; **issue was after** “OAuth token received” for SMTP.

## Symptoms

- **Agent** `send_draft` or inbox **Send** spins then fails with e.g. **`ripmail exited 1`**; stderr shows progress through **“OAuth token received; constructing XOAUTH2 transport…”** and **“sending message via SMTP to …”** then failure or hang until Node/ripmail timeout.
- **New Relic** `ToolCall` custom event: **`send_draft`**, **`success: false`**, **~60s** `durationMs` in observed failure (dependent on `RIPMAIL_SEND_TIMEOUT_MS` and when ripmail returns).
- **APM** `POST /api/chat` can be **tens of seconds** for the whole streaming turn, not a dedicated “send” transaction name.

## Evidence (2026-04, staging)

| Check | Result |
| ----- | ------ |
| **`nc -vz -w 10 smtp.gmail.com 587`** on Droplet | IPv4: **Connection timed out**; IPv6: **Network is unreachable** (v6 not assumed). |
| **ripmail stderr** (truncated in NR) | Reaches **SMTP endpoint smtp.gmail.com:587**, **GoogleOAuth**, **OAuth token received**, last line before block: **sending message via SMTP** (then fails / hang). |
| **Cloud firewall** `braintunnel-staging-fw` | **Outbound** TCP to `0.0.0.0/0` is **all ports** (API shows `ports: "0"` = all in DO for TCP); **not** the layer blocking 587. |
| **DO support doc** | [Why is SMTP blocked?](https://docs.digitalocean.com/support/why-is-smtp-blocked/) — **25, 465, 587** blocked **on Droplets by default**; recommends third‑party email for app sending. |
| **“Unblock”** | **Not** a `doctl` / UI toggle; policy is **per‑platform**; support request *may* allow SMTP for an account, **not guaranteed**. |

## Why this is not fixed by “change OAuth client type in Cloud Console”

- **Token HTTP** to Google (OAuth) uses **port 443** and **succeeds** in staging; **SMTP** uses **a different** destination (`smtp.gmail.com:587` / STARTTLS) and was **dropped** before application‑level auth completed.
- **Gmail in the browser** / **IMAP in ripmail** do not prove **outbound 587** from the Droplet is open.

## Product constraint: “send as the user’s Gmail”

- **SendGrid, Mailgun, Postmark, etc.** send from **their** infrastructure / your verified domain; they do **not** substitute for **“this message is sent from the user’s @gmail.com identity”** in the way **`ripmail send` + user mailbox OAuth** is designed to.
- A proper hosted fix stays under **the same Google account / OAuth** story: **Gmail API** to **insert/send** a message, or a **Google‑approved** relay model that still reflects the user (see [Google’s Workspace SMTP relay](https://support.google.com/a/answer/2956491) for **admin‑configured** relay — different product surface than consumer `@gmail.com`).

## Fix direction (implemented)

1. **Gmail API over HTTPS (443)**  
   - After user has granted scopes, use **`users.messages.send`** (or equivalent) with a **raw RFC 822** payload. **Shipped** in ripmail for Gmail+OAuth; egress is **TLS to `gmail.googleapis.com`**, unblocked on DO.

2. **Keep `ripmail send` SMTP for local / non-DO** where 587 is not blocked.

3. **Do not rely on DO unblocking SMTP** for general availability; treat any unblock as **optional** for operators who self‑host outside DO or get an exception.

4. **Observability**  
   - Increase error tail for **`send_draft`** / ripmail in **`ToolCall.errorMessage`** (or separate attribute) so **SMTP** vs **API** errors stay distinguishable; cap safely for secrets.

## Related code (brain-app)

- **`send_draft` tool** — `src/server/agent/tools.ts` → `execRipmailAsync(…, { timeout: RIPMAIL_SEND_TIMEOUT_MS })`  
- **Inbox send route** — `src/server/routes/inbox.ts`  
- **Ripmail run / timeouts** — `src/server/lib/ripmailRun.ts` (`RIPMAIL_SEND_TIMEOUT_MS`)  
- **NR `ToolCall`** — `src/server/lib/newRelicHelper.ts` (`recordToolCallEnd`); `streamAgentSse.ts` may truncate `errorMessage` (see in‑app investigations).

## Related code (ripmail / Rust)

- **Gmail API send** — `ripmail/src/send/gmail_api_send.rs`  
- **SMTP send (non-Gmail or fallback)** — `ripmail/src/send/smtp_send.rs` — `transport.send(&email)` after OAuth for XOAUTH2 where API path is not used.

## References

- [DigitalOcean: Why is SMTP blocked?](https://docs.digitalocean.com/support/why-is-smtp-blocked/)
- [Gmail API: Sending Email](https://developers.google.com/gmail/api/guides/sending) (users.messages.send, etc.)
- [Google Workspace: SMTP relay](https://support.google.com/a/answer/2956491) (admin / Workspace; not a substitute for all consumer-Gmail product designs)
