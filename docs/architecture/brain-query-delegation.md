# Brain-query delegation (mail-first, hosted)

Cross-tenant collaboration is **grant-gated** and **mail-first**: collaborators exchange questions and answers through **ordinary email** (subject marker **`[braintunnel]`**), Ripmail **`notify`**, and tenant **`notifications`**. There is **no** synchronous cross-tenant agent RPC or shared query log table.

**Policy model:** [brain-to-brain-access-policy.md](./brain-to-brain-access-policy.md) — three layers (capabilities, hard predicates, soft ALLOW/DISALLOW fragments); today each grant still carries a **denormalized `privacy_policy` textarea** until **policy-by-reference** ships — see [Denormalized `privacy_policy` on grants (follow-up)](./brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up).

**Hub admin (Spike 1)** for grants and policy editing: closed **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** — [brain-to-brain-access-policy.md § closure](./brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure).

**Next evolution:** **[OPP-110](../opportunities/OPP-110-chat-native-brain-to-brain.md)** — replace the mail-first transport with a **chat-native B2B** model: conversations with other brains live in the chat sidebar alongside chats with your own brain.

**Purge of synchronous stack:** **[OPP-106](../opportunities/OPP-106-email-first-cross-brain-collaboration.md)** (archived body: [archive/OPP-106…](../opportunities/archive/OPP-106-email-first-cross-brain-collaboration.md)) — removed `runBrainQuery`, `ask_brain`, preview APIs, `brain_query_log`, and `brain_query_inbound` UX; kept **`brain_query_grants`** CRUD and mail-driven **`brain_query_mail`** / **`brain_query_grant_received`** notifications.

- **Idea / product:** [IDEA-brain-query-delegation.md](../ideas/IDEA-brain-query-delegation.md) · **Notifications:** [IDEA-anticipatory-assistant-brief.md](../ideas/IDEA-anticipatory-assistant-brief.md) · **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** (**shipped** — `var/brain-tenant.sqlite`) · [brain-to-brain-access-policy.md § notification](./brain-to-brain-access-policy.md#notification-inbox-and-human-in-the-loop-prerequisite-for-secure-brain-to-brain)
- **Global DB:** `brain_query_grants` only (no `brain_query_log`) in [`brainGlobalDb.ts`](../../src/server/lib/global/brainGlobalDb.ts) alongside `wiki_shares`; schema version bump recreates the file per early-dev rules.
- **API (when `BRAIN_B2B_ENABLED`):** `GET/POST/PATCH/DELETE /api/brain-query/grants` — grants only.
- **Settings / Hub UI:** Sharing → **Brain to Brain** / **Brain access** — policies, collaborators, revokes; no preview or inbound “audit log” tied to a sync pipeline.

## Manual smoke (two workspaces)

Requires `nvm use`, `npm run dev`, `BRAIN_B2B_ENABLED`, two accounts with confirmed handles and mail connected.

1. **Owner:** grant access to a collaborator (Hub or Settings → Brain access).
2. **Collaborator:** send or draft mail using the **`[braintunnel]`** subject marker; owner receives **`brain_query_mail`** (and/or related notify path) and can open chat with mail tools.
3. **Human-in-the-loop:** answers go through normal **`draft_email`** / **`send_draft`** flows — no cross-tenant streaming query endpoint.

## Automated tests

- **Grants repo / HTTP:** create/list/revoke/edit, unique `(owner_id, asker_id)`, default policy seed; route tests cover grant CRUD only.
- **Notifications:** presentation + kickoff context for **`brain_query_mail`** and **`brain_query_grant_received`**; legacy inbound notification kinds fall through to generic presentation where rows still exist on disk.
