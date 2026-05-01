# Archived: OPP-055 — Multipart alternative outbound

**Archived 2026-05-01.** **Status:** Implemented (landed 2026-04). **Stable link:** [stub `../OPP-055-multipart-alternative-html-plain-outbound.md`](../OPP-055-multipart-alternative-html-plain-outbound.md).

---

# OPP-055: Multipart alternative — HTML + plain text for outbound mail

**Status:** Landed in ripmail (2026-04) — `multipart/alternative` with **`text/plain`** (first) and **`text/html`** (second), SMTP and Gmail API raw MIME.

## Summary

Ripmail used to build outbound as **`text/plain` only** (`lettre` `SinglePart`). Outbound is now **`multipart/alternative`**: the plain part is unchanged in semantics (markdown → plain via [`draft_markdown_to_plain_text`](../../../src/send/draft_body.rs)), and the HTML part is from the same draft via [`draft_markdown_to_html`](../../../src/send/draft_body.rs) (`pulldown_cmark::html::push_html`, wrapped in a minimal document with `charset` via `<meta charset="utf-8">`). **CLI ad-hoc** `ripmail send --to … --body …` leaves `SendSimpleFields::html` unset; the server derives HTML with [`plain_to_minimal_html`](../../../src/send/draft_body.rs) from the **normalized** plain body (escape + `<p>` / `<br>`) so the HTML matches what a human sees in the plain part, without applying markdown to ad-hoc bodies.

- **Build:** [`send_simple_message`](../../../src/send/smtp_send.rs) — `MultiPart::alternative_plain_html(plain, html)`.
- **Gmail API:** still posts `email.formatted()`; no API change ([`gmail_api_send.rs`](../../../src/send/gmail_api_send.rs)).
- **Draft send path:** [`send_draft_by_id`](../../../src/send/mod.rs) sets `html: Some(draft_markdown_to_html(&draft.body))`.

RFC 2046 ordering: **plain first, HTML last** (least rich → most rich for MUAs that walk parts).

## Motivation

- **Plain only** is fine for agents and terminals but link/typography behavior varies; HTML gives predictable links and list formatting in GUI clients.
- **HTML only** is poor practice; **`multipart/alternative`** with a faithful plain part is the standard compromise (accessibility, filtering, and agentic flows that read `text/plain` first).

## 2026 compatibility — what actually bites (and what does not)

**Not a real problem for *this* design (long tail de‑emphasized):**

- **“Clients pick the wrong part”** — In practice, mainstream clients choose `text/html` for display and keep `text/plain` for “view as plain / reply as plain / accessibility.” We emit both from one source; drift is a product choice to test, not a transport mystery.
- **IE-era HTML** — We are not using `<table>` layout or ActiveX. Semantic tags from pulldown-cmark are fine.

**Genuine but manageable risks:**

| Risk | Why it matters | Mitigation in ripmail |
|------|----------------|------------------------|
| **Outlook (classic Win32 / older Word engine)** | Weak CSS, strips `<style>` in `<head>`, quirky box model. | We avoid newsletter CSS, external styles, and complex layout. Semantic HTML + default typography only. |
| **Gmail (web and mobile)** | Strips/rewrites a lot of `<head>`; images and remote content are special-cased. | No embedded/remote resources in v1; minimal `<body>` only. |
| **Quoted-printable and line length** | Long bodies are QP in `lettre`; boundaries must not break paragraph intent. | Existing QP regression tests for plain; multipart uses the same builder path. |
| **Charset** | Mojibake if parts disagree. | UTF-8; HTML includes `<meta charset="utf-8">`; `lettre` sets part content-types consistently. |
| **Spam / bulk filters (ESP heuristics)** | Heavy image/HTML ratio, bad headers, or HTML–plain mismatch can look bulk. | We keep a readable plain part that reflects the same content; no image-only HTML. |

**2026 “agentic” and automation clients (Braintunnel, `ripmail` in chat, other MIME-aware agents):**

- **Structured extraction** — Many agents prefer **`text/plain`** (token efficiency, no tag noise). We keep a strong, markdown-derived plain part for drafts, so the agent and the human can agree on the same string family as today.
- **“Read as mail” in a WebView** — Braintunnel-style UIs that render like a mail client will typically show **HTML** when present; the plain part remains for “raw” or accessibility toggles. No extra work in ripmail beyond correct MIME.
- **Pipelines that parse RFC 822** — `multipart/alternative` is the *expected* shape; a parser that only took the first body part would still get **plain** (our first child part), which is the right fallback for tools that do not want HTML.
- **Drift (plain says X, HTML says Y)** — The highest risk is **us** generating inconsistent parts. Mitigation: **one markdown source** for drafts (plain + HTML from the same `draft.body`); CLI path does not reinterpret markdown, so **minimal HTML is derived from normalized plain** only.

## Scope (as implemented)

- **MIME:** `MultiPart::alternative_plain_html` in [`smtp_send.rs`](../../../src/send/smtp_send.rs).
- **HTML (drafts):** `draft_markdown_to_html` — `pulldown_cmark` HTML renderer, same options as plain, document wrapper, no raw pasted HTML.
- **HTML (CLI, no `html` field):** `plain_to_minimal_html` after plain normalization.
- **Tests:** Unit tests in `draft_body.rs` and `smtp_send.rs` (`formatted_multipart_alternative_plain_and_html`); existing QP/paragraph tests preserved on `SinglePart` fixtures where still relevant.

## Non-goals (still)

- **HTML-only** outbound without a real **`text/plain`** sibling.
- Full newsletter layout, custom fonts, or embedded images (separate “rich compose” work if ever).
- Changing **inbox display** in Braintunnel (client/UI), beyond what sync already does for `multipart/alternative` inbound.

## Related

- **Send / drafts (archived):** [OPP-011 archived](OPP-011-send-email.md), [ADR-024](../../ARCHITECTURE.md#adr-024-outbound-email--smtp-send-as-user--local-drafts) in `ARCHITECTURE.md`.
- **Brain-app:** Inbox “send draft” shells `ripmail send`; pick up a newer `ripmail` binary — [brain-app `docs/OPPORTUNITIES.md`](../../../../docs/OPPORTUNITIES.md).

## Acceptance criteria

- [x] Outbound messages are **`multipart/alternative`** with **`text/plain`** and **`text/html`**, SMTP and Gmail API (same `Message` build, `formatted()` bytes).
- [x] Drafts: plain remains markdown → plain; HTML is from the same `draft.body` (no second pipeline).
- [x] CLI: plain behavior unchanged; HTML is minimal from normalized plain.
- [x] Unit/integration coverage for MIME shape and `mail_parser` round-trip.
