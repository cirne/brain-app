# Opportunities

Improvement ideas and future features discovered through usage. Each entry captures the problem, motivation, and proposed direction.

Active and future work lives in [opportunities/](opportunities/). Shipped and deprioritized work moves to [opportunities/archive/](opportunities/archive/).

### Ripmail crate (`ripmail/`)

The **ripmail** workspace member (local-first email CLI + SQLite index) maintains a **separate** opportunity index and ID namespace: **[`ripmail/docs/OPPORTUNITIES.md`](../ripmail/docs/OPPORTUNITIES.md)** with files under [`ripmail/docs/opportunities/`](../ripmail/docs/opportunities/). `OPP-*` numbers in ripmail are **not** aligned with brain-app `OPP-*` (e.g. brain-app [OPP-012](opportunities/OPP-012-brain-home-data-layout.md) vs ripmail [OPP-012](../ripmail/docs/opportunities/OPP-012-who-smart-address-book.md)). Link across trees when a feature touches both the web app and ripmail (example: [OPP-005](opportunities/OPP-005-source-ingestion.md) → [ripmail OPP-051](../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)).

---

## Active


| ID                                                             | Title                        | Summary                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OPP-001](opportunities/OPP-001-agent-to-agent.md)             | Agent-to-Agent Communication | Federated brain-to-brain protocol: email-bootstrapped handshake, permissioned direct channel, enables scheduling/knowledge-sharing/delegation across brains. Network-effect moat.                                         |
| [OPP-002](opportunities/OPP-002-public-brain-identity.md)      | Public Brain Identity        | Your brain as a public-facing entity: tiered access (anonymous/verified/connected), web presence, inbound triage, automated discovery via DNS/WebFinger/directories. The top of the OPP-001 funnel.                       |
| [OPP-003](opportunities/OPP-003-iMessage-integration.md)       | iMessage (local DB)          | Read-only tools against macOS `chat.db`: recent messages (time window, unread), threads; agent correlates wiki person pages (phone/handles) with SMS/iMessage; "what have I heard from Brett?" → wiki + messages + email. |
| [OPP-004](opportunities/OPP-004-wiki-aware-agent.md)           | Wiki-Aware Agent             | Move from general coding agent to structured wiki operations: typed changelog (replaces _log.md append), background lint cron, path validation with soft warnings. Higher quality with less agent surface area.           |
| [OPP-005](opportunities/OPP-005-source-ingestion.md)           | Source Ingestion Pipeline    | **Superseded** — see [ripmail OPP-051](../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) (folders + files as first-class sources in one index). Archived brain-app sketch: [archive](opportunities/archive/OPP-005-source-ingestion-brain-app-upload-pipeline.md). |
| [OPP-006](opportunities/OPP-006-email-bootstrap-onboarding.md) | Email-Bootstrap Onboarding   | Connect email, watch wiki build itself. Onboarding agent analyzes inbox to create user profile, people pages, and project pages in minutes. Zero data entry, feels magical. Research-driven.                              |
| [OPP-007](opportunities/OPP-007-native-mac-app.md)             | Native Mac App               | Package as macOS app running server locally. Enables full access to iMessage, Contacts, Notes, files without sync. Remote access via Tailscale. Local-first, privacy-preserving.                                          |
| [OPP-008](opportunities/OPP-008-tunnel-qr-phone-access.md)     | Tunnel + QR Phone Access     | Cloudflare Tunnel (or similar) from Mac-local brain to the internet; QR encodes URL (+ optional pairing) for scan-to-open on phone. Remote access without VPN app on phone; complements Tailscale story in OPP-007.       |
| [OPP-009](opportunities/OPP-009-oauth-relay-in-app.md)         | OAuth relay in app           | Replace the old ripmail `oauth-relay` Cloudflare Worker with Hono/server-side handling in brain-app for hosted OAuth used by ripmail.                                                                                    |
| [OPP-010](opportunities/OPP-010-user-skills.md)                | User Skills (slash commands) | Slack-style `/` menu backed by `SKILL.md` files (Claude Code / Cursor / OpenClaw format) stored in `<WIKI_DIR>/skills/` — user-editable, git-versioned defaults `/wiki`, `/research`, `/email` ([OPP-011](opportunities/OPP-011-user-skills-strategy.md)).     |
| [OPP-011](opportunities/OPP-011-user-skills-strategy.md)     | User skills strategy         | Granularity, `/wiki` umbrella + NL routing; maps toolset to skill domains. Companion to OPP-010; see [product/personal-wiki.md](product/personal-wiki.md) for vocabulary and onboarding.                                      |
| [OPP-012](opportunities/OPP-012-brain-home-data-layout.md)   | Brain home data layout       | Replace overloaded `WIKI_DIR` with `BRAIN_HOME` + explicit subdirs (wiki, ripmail, chats, cache); default `RIPMAIL_HOME` under home; inventory of env/modules/Tauri/Docker; no migration — wipe and re-seed.                 |


---

## Implemented (archived)


| ID  | Title | Summary |
| --- | ----- | ------- |


---

## Will Not Do / Deprioritized


| ID  | Title | Summary |
| --- | ----- | ------- |


