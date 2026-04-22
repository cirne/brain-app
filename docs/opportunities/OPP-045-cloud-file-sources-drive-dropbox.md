# OPP-045: Cloud file sources (Google Drive, Dropbox)

**Status:** Open.

**Created:** 2026-04-22.

**Related:** [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) (unified `sources` model; `localDir` for on-disk files), [OPP-040](OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md) (One / Pica as optional connector accelerator), [OPP-021](OPP-021-user-settings-page.md) (Hub data-sources shell), [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) / [shipped OPP-019](OPP-019-gmail-first-class-brain.md) (Google OAuth surface area for additional scopes).

**Tags:** desktop, ingests

---

## Summary

Bring **user-chosen cloud folders and files** into the same “search and ground on my documents” story as the **desktop app’s** path-granted local directories: explicit consent, then **sync or incremental fetch** into the **unified personal corpus** (ripmail’s evolving `sources[]` + index), not ad hoc uploads per chat turn.

**Google Drive** is the lead candidate (many users already store docs there; **Google** OAuth and trust patterns overlap existing Gmail work). **Dropbox** is a strong **short-term** second target: mature Files API, familiar OAuth, similar **list + download + version** semantics to Drive—worth implementing **in the same connector shape** (one `kind` or two sibling kinds sharing helpers) so we do not design twice.

---

## Problem

- **Local-only** indexing (`localDir` / Tauri folder picks) does not see files that live **only in cloud** (no Desktop sync, different machine, or user expectation of “read my Drive” without mirroring the whole tree to disk).
- **Per-file upload in chat** does not scale to “treat this Drive/Dropbox tree like my `~/Documents` grant.”
- [packaging-and-distribution.md](../packaging-and-distribution.md) already flags **cloud-drive OAuth** or **sync client** as the honest alternatives to “automatic indexing of arbitrary paths” for non-local data.

---

## Proposed direction

1. **Ripmail + brain-app alignment** — New source `kind`(s) under [OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) (e.g. `googleDrive`, `dropbox`); credentials under `RIPMAIL_HOME/<id>/`; `refresh` pulls metadata + file bytes, reuse **text extraction** used for local files and mail attachments; hits carry `source_id` in search/read JSON.
2. **OAuth in brain-app** — Connect flows, scope consent, and token storage follow the same Hono + vault patterns as mail where applicable; **additional Google scopes** (Drive) must be weighed against [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) verification and consent-screen limits.
3. **Hub** — “Data sources” lists connected cloud providers alongside mail and local dirs ([OPP-021](OPP-021-user-settings-page.md) scaffolding).
4. **Short term** — Sequencing can favor **Dropbox and Drive in parallel** as engineering capacity allows, but **treat them as one product bet** (cloud file sources), not two unrelated projects.

**Optional accelerator:** [OPP-040](OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md) if we prefer breadth via a hosted integration layer; tradeoffs (privacy, vendor, cost) apply.

---

## Non-goals (for this OPP’s first slice)

- Full **two-way** sync or editing files in the cloud from Braintunnel (read + index for grounding is the default first milestone).
- Replacing the **local** `localDir` path; cloud complements it.
- **Ripmail** [OPP-045 (iMessage / unified messaging)](../../ripmail/docs/opportunities/OPP-045-imessage-and-unified-messaging-index.md) — different `OPP-045` id in the **ripmail** tree; only the number collides by convention across namespaces.

---

## Open questions

- Incremental sync: **change tokens** (Drive) vs **cursor/list** (Dropbox) + conflict policy for re-auth.
- **Size / quota** caps: max file bytes, folder depth, and whether to index **shared-with-me** vs **My Drive** only.
- **Hosted vs desktop**: OAuth redirect and token storage when brain-app runs in cloud vs Tauri (reuse patterns from OPP-019/041 as applicable).
