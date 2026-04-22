# OPP-044: Multiple email accounts, one Braintunnel handle

## Summary

A user should be able to **authorize a second (or Nth) Gmail** (and later other mailbox types) and still be **one Braintunnel identity**—**one handle**, one vault, one wiki profile—not a new account per mailbox.

**Ripmail already supports multiple mailboxes** in one install: unified `ripmail.db`, `mailboxes[]` in `config`, per-mailbox sync and `mailbox_id` in the index (see [ripmail OPP-016 — Multi-Inbox, archived](../ripmail/docs/opportunities/archive/OPP-016-multi-inbox.md), and [ripmail OPP-044 — per-mailbox config, archived](../ripmail/docs/opportunities/archive/OPP-044-per-mailbox-sync-and-smtp-config.md) for follow-on modeling). The product gap is **Braintunnel (brain-app)**: how **Google OAuth and session** map to **linked mailboxes** under a single user, plus Hub and agent UX.

## Problem

- People commonly have **work and personal** Gmail; forcing a single “primary” OAuth mailbox is a ceiling on usefulness.
- **Inter-brain and social identity** are handle-first ([OPP-042](OPP-042-brain-network-interbrain-trust-epic.md)); that should not multiply when a user adds another inbox.

## Motivation

- Match real-world **one person, many mailboxes** without fragmenting product identity.
- Reuse the **local-first** ripmail stack instead of re-solving indexing.

## Proposed direction (high level)

- **Account linking:** store **additional** Google (Gmail) OAuth tokens as **linked identities** under the same Braintunnel user; persist on-disk consistently with the Gmail-first path ([OPP-019](OPP-019-gmail-first-class-brain.md)) and ripmail’s `RIPMAIL_HOME` / `config` expectations.
- **Hub / settings:** add mailbox, **default send** / default search scope, and per-mailbox **sync or status** (aligned with what ripmail exposes).
- **Agent and tools:** search/read/cross-thread behavior should be **explicit or merged** in line with `mailbox_id` and multi-inbox ripmail APIs—no silent wrong-mailbox context.

## Non-goals (initially)

- **Fully automatic** “same human” unification in contacts across mailboxes (may intersect [OPP-037](OPP-037-messages-index-and-unified-people.md) later).
- **Non-Gmail** connectors beyond what ripmail + OAuth flows already support—sequence after Gmail N-mailbox is credible.

## Related

- [OPP-019](OPP-019-gmail-first-class-brain.md) — Gmail OAuth, shared on-disk with ripmail.
- [ripmail OPP-016 (archived)](../ripmail/docs/opportunities/archive/OPP-016-multi-inbox.md) — multi-mailbox architecture.
- [ripmail OPP-051 — unified sources](../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) — corpus and connectors.
- [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) — Google OAuth verification caps (may affect how many “test users” or consent surfaces you maintain).

**Status:** Open
