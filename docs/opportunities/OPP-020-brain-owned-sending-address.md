# OPP-020: Send mail from a Brain-operated address (on behalf of the user)

## Summary

**Contingent path:** Some product scenarios may call for **outbound mail whose RFC 5322 `From` is a Brain-controlled domain** (e.g. `you@brain.example` or `assistant@…`), with Brain (or a managed mail path) performing **submission and delivery**, rather than sending **through the user’s Gmail/SMTP** as themselves.

This is **not** the same as [OPP-019](OPP-019-gmail-first-class-brain.md) (connect the user’s Gmail for sync and send-as-user). It is a **parallel** option for specific flows: notifications, assistant-initiated messages where the product wants a **single trusted sender identity**, or jurisdictions where routing mail through the user’s mailbox is undesirable.

## Problem

- **User mailbox connectors** (Gmail OAuth, IMAP, etc.) optimize for **“I send as me”** and **thread continuity** in the user’s existing archive.
- Some ideas—broadcasts, system mail, or a deliberately **branded assistant identity**—may be simpler or clearer if **Brain is the visible sender**, with explicit **on behalf of** semantics.

## Pros

- **One delivery pipeline:** SPF/DKIM/DMARC for a **known domain** you control; fewer per-user SMTP edge cases for those messages.
- **Clear product semantics:** Recipients see mail from **Brain** (or your domain), not a spoofed or delegated personal address.
- **Useful when the user has no connector yet** or when OAuth is broken—still not a substitute for a real “from me” path for personal correspondence.

## Cons

- **Identity mismatch:** Professional and personal email usually **must** come from the user’s real address; a Brain `From` can feel wrong or trigger spam/suspicion unless expectations are set.
- **Threading:** Ongoing conversations in Gmail often key off **the user’s address**; a Brain `From` **forks threads** unless `Reply-To`, `In-Reply-To`, and user habits align carefully.
- **Trust and compliance:** “On behalf of” must be **transparent** (signatures, product copy, optional `Reply-To: user@gmail.com`).

## User experience (sketch)

- **Explicit mode:** User opts in to **Send via Brain address** for certain categories (e.g. “assistant summaries,” “shared digests”) vs. **Send from my Gmail** for normal mail.
- **Composition:** Brain still drafts with full context; only the **transport and From** differ.
- **Recipient view:** Clear **From** (Brain domain), optional **Reply-To** to the user’s real mailbox so replies land in the right place.

## Technical direction (high level)

- **Outbound submission:** A **managed SMTP/API** path (provider TBD) for the Brain domain; separate from ripmail’s user-IMAP submission.
- **No requirement** to store the user’s password for this path—Brain’s infrastructure sends as the **product identity**.
- **Inbound** to that address (if any) is a separate product decision (support inbox, bounce handling).

## Relationship to other docs

- [OPP-019](OPP-019-gmail-first-class-brain.md) — primary path for **real user mailbox** integration and ripmail sync.
- [OPP-006](OPP-006-email-bootstrap-onboarding.md) — onboarding may offer **connect Gmail** first; Brain-owned sending remains **advanced or secondary**.

## Open questions

- Whether this ships at all before **Gmail-first** (OPP-019) is stable—likely **later**.
- **Reply-To** policy: always user’s primary connected address when available?
- **Legal / abuse:** rate limits, reporting, and domain reputation separate from user connectors.

## Status

**Exploratory / future.** Capture product scenarios before investing in domain, mail ops, and UI modes.