# OPP-045: Google Drive as an indexed source

**Status:** Open.

**Created:** 2026-04-22 (cloud file sources). **Updated:** 2026-04-30 — Drive-only opp + [external-data-sources.md](../architecture/external-data-sources.md); OAuth Console-vs-client gap for Drive read scope.

**Tags:** desktop, ingests

---

## Summary

Ship **user-selected Google Drive folders** into the same **local-first search corpus** as mail and `localDir`: OAuth consent, incremental sync into ripmail’s `**sources[]`** index, unified agent tools—see **[external-data-sources.md](../architecture/external-data-sources.md)** for the full plan (query vs sync, contentless FTS5, tool shape, brain-app vs ripmail split).

This opportunity tracks **Drive-specific** scope: OAuth scopes vs [OPP-043](OPP-043-google-oauth-app-verification-milestones.md), Hub surfacing ([OPP-021](OPP-021-user-settings-page.md)), ripmail `kind: googleDrive`, and implementation follow-ups. Other cloud file hosts can reuse the same architecture later without duplicating this doc.

---

## OAuth: Drive read access (Console vs client)

Indexing Drive requires **user-granted read access** (typically `**https://www.googleapis.com/auth/drive.readonly`** or a narrower files-only variant once we settle listing vs export behavior—exact URI is an implementation detail; verification impact stays under [OPP-043](OPP-043-google-oauth-app-verification-milestones.md)).

**Gap today:** The OAuth client in Google Cloud Console can already **declare** Drive scopes (for verification / consent-screen configuration), but **Braintunnel’s authorize request does not include Drive yet** — see `**GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS`** in `[src/server/lib/platform/googleOAuth.ts](../../src/server/lib/platform/googleOAuth.ts)` and its use in `[src/server/routes/gmailOAuth.ts](../../src/server/routes/gmailOAuth.ts)` (Gmail + Calendar events + `openid` / email only). Users therefore **do not see Drive on the Google permissions screen** at sign-in until we **append the Drive read scope(s)** to that request (and handle **incremental authorization** or **re-connect** for accounts that already completed OAuth without Drive).

After shipping: confirm the live consent UI lists Drive alongside Gmail and Calendar (see product screenshots / Google Account “third-party access” summary).

---

## Problem

- **Local-only** grants (`localDir`) miss files that live **only** in Drive (no Desktop sync, different machine).
- **Per-chat uploads** do not scale to “search my Drive tree like `~/Documents`.”

---

## Scope (aligned with architecture doc)

1. **Ripmail index (`@server/ripmail`)** — `googleDrive` source kind under [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md); credentials under tenant `ripmail/<source-id>/`; **`refresh`** pulls metadata + bytes for tokenization into **contentless** FTS (ADR-030 on [Rust snapshot](../architecture/ripmail-rust-snapshot.md)); search JSON includes `sourceId` / `sourceKind`.
2. **brain-app** — connect flow and token storage consistent with Gmail work ([OPP-019](OPP-019-gmail-first-class-brain.md)); **request Drive read scope(s) in the OAuth authorize URL** (today missing — see § OAuth above); verification/consent implications ([OPP-043](OPP-043-google-oauth-app-verification-milestones.md)).
3. **Agent tools** — `**search_index`**, `**list_files`**, `**read_doc**`, `**manage_sources**`, `**refresh_sources**` parameterized by source—not standalone `google_drive_*` tools ([architecture doc § Unified agent tools](../architecture/external-data-sources.md#unified-agent-tools-source-parameter-not-per-vendor)).

**Optional accelerator:** [OPP-040](OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md).

---

## Spike notes (`google-drive` branch)

Prior work (~`59072ac`) validated direction (`kind=googleDrive`, unified sources, OAuth wiring). Issues were **implementation**, not architecture—cross-check Drive regression notes on the Rust snapshot tag if needed ([ripmail-rust-snapshot.md](../architecture/ripmail-rust-snapshot.md)). Wrong tool names (`google_drive_list`/`google_drive_search`) conflict with the unified tool policy above.

---

## Non-goals (first milestone)

- Two-way edit/sync from Braintunnel into Drive.
- Replacing `**localDir`**; Drive complements local grants.
- Vector search replacing FTS5 for this milestone.

---

## Open questions (Drive-specific)

- Change tokens vs full reconciliation + re-auth edge cases.
- Caps: max bytes per file, depth, **My Drive** vs **Shared with me**.
- `**read_doc`** cache TTL under `RIPMAIL_HOME/<source-id>/cache/`.
- Hosted vs desktop OAuth parity ([OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md) / hosted stubs).

---

## Namespace note

**ripmail** uses a **different** [OPP-045 (iMessage / unified messaging)](OPP-083-imessage-and-unified-messaging-index.md). IDs are **not** shared across repos—only the number collides by convention.