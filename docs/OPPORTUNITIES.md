# Opportunities

Improvement ideas and future features discovered through usage. Each entry captures the problem, motivation, and proposed direction.

Active and future work lives in [opportunities/](opportunities/). Shipped and deprioritized work moves to [opportunities/archive/](opportunities/archive/).

---

## Active


| ID                                                             | Title                        | Summary                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OPP-001](opportunities/OPP-001-agent-to-agent.md)             | Agent-to-Agent Communication | Federated brain-to-brain protocol: email-bootstrapped handshake, permissioned direct channel, enables scheduling/knowledge-sharing/delegation across brains. Network-effect moat.                                         |
| [OPP-002](opportunities/OPP-002-public-brain-identity.md)      | Public Brain Identity        | Your brain as a public-facing entity: tiered access (anonymous/verified/connected), web presence, inbound triage, automated discovery via DNS/WebFinger/directories. The top of the OPP-001 funnel.                       |
| [OPP-003](opportunities/OPP-003-iMessage-integration.md)       | iMessage (local DB)          | Read-only tools against macOS `chat.db`: recent messages (time window, unread), threads; agent correlates wiki person pages (phone/handles) with SMS/iMessage; "what have I heard from Brett?" → wiki + messages + email. |
| [OPP-004](opportunities/OPP-004-wiki-aware-agent.md)           | Wiki-Aware Agent             | Move from general coding agent to structured wiki operations: typed changelog (replaces _log.md append), background lint cron, path validation with soft warnings. Higher quality with less agent surface area.           |
| [OPP-005](opportunities/OPP-005-source-ingestion.md)           | Source Ingestion Pipeline    | Replace filesystem-based ingestion with upload endpoint, URL fetching, email attachment extraction, and file type handlers (PDF, XLSX, images via vision). Works in containers, supports mobile.                          |
| [OPP-006](opportunities/OPP-006-email-bootstrap-onboarding.md) | Email-Bootstrap Onboarding   | Connect email, watch wiki build itself. Onboarding agent analyzes inbox to create user profile, people pages, and project pages in minutes. Zero data entry, feels magical. Research-driven.                              |
| [OPP-007](opportunities/OPP-007-native-mac-app.md)             | Native Mac App               | Package as macOS app running server locally. Enables full access to iMessage, Contacts, Notes, files without sync. Remote access via Tailscale. Local-first, privacy-preserving.                                          |
| [OPP-008](opportunities/OPP-008-tunnel-qr-phone-access.md)     | Tunnel + QR Phone Access     | Cloudflare Tunnel (or similar) from Mac-local brain to the internet; QR encodes URL (+ optional pairing) for scan-to-open on phone. Remote access without VPN app on phone; complements Tailscale story in OPP-007.       |


---

## Implemented (archived)


| ID  | Title | Summary |
| --- | ----- | ------- |


---

## Will Not Do / Deprioritized


| ID  | Title | Summary |
| --- | ----- | ------- |


