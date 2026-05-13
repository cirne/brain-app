# Brain-query grants and Braintunnel B2B

Cross-brain collaboration is **grant-gated**: who may query whose workspace, with per-connection **privacy policy** prose (until **policy-by-reference** ships — [Denormalized `privacy_policy` on grants (follow-up)](./brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up)).

**Canonical transport (today):** **chat-native Braintunnel** — **Tunnels** in the assistant UI, HTTP **`/api/chat/b2b`**, paired **`b2b_outbound`** / **`b2b_inbound`** sessions in tenant SQLite, **cold query** and **review / approve** before the asker sees the final reply. **Architecture SSOT:** **[braintunnel-b2b-chat.md](./braintunnel-b2b-chat.md)**.

**Policy model:** [brain-to-brain-access-policy.md](./brain-to-brain-access-policy.md) — three layers (capabilities, hard predicates, soft ALLOW/DISALLOW fragments).

**Hub admin (Spike 1)** for grants and policy editing: closed **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** — [brain-to-brain-access-policy.md § closure](./brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure).

**Specs / direction:** [IDEA-brain-query-delegation.md](../ideas/IDEA-brain-query-delegation.md) · Chat-native rollout: [archived OPP-110](../opportunities/archive/OPP-110-chat-native-brain-to-brain.md), [archived OPP-111](../opportunities/archive/OPP-111-tunnel-fast-follows.md) (shipped 2026-05-12).

- **Global DB:** `brain_query_grants` (no `brain_query_log`) in [`brainGlobalDb.ts`](../../src/server/lib/global/brainGlobalDb.ts) alongside `wiki_shares`; schema version bump recreates the file per early-dev rules.
- **API (when `BRAIN_B2B_ENABLED`):**
  - **`GET/POST/PATCH/DELETE /api/brain-query/grants`** — grant CRUD only.
  - **`/api/chat/b2b/*`** — tunnel threads, cold query, review queue — [braintunnel-b2b-chat.md](./braintunnel-b2b-chat.md).
- **Settings / Hub UI:** Sharing → **Brain to Brain** / **Brain access** — policies, collaborators, revokes.

## Automated tests

- **Braintunnel B2B:** [`b2bChat.test.ts`](../../src/server/routes/b2bChat.test.ts); Playwright [`b2b-sharing.spec.ts`](../../tests/e2e/b2b-sharing.spec.ts).
- **Grants repo / HTTP:** create/list/revoke/edit, unique `(owner_id, asker_id)`, default policy seed; route tests cover grant CRUD.
- **Notifications:** presentation + kickoff for **`b2b_inbound_query`**, **`b2b_tunnel_outbound_updated`**, **`brain_query_grant_received`**, Ripmail-originated kinds (`mail_notify`, etc.). Legacy **`brain_query_mail`** rows may still exist on disk from older experiments.

## Historical: mail as collaboration transport (OPP-106)

An earlier experiment used **ordinary email** (subject marker **`[braintunnel]`**), Ripmail, and **`brain_query_mail`** notifications so collaborators could coordinate without a chat tunnel API. That is **not** the current product architecture — **Braintunnel B2B** uses **server-mediated chat sessions** ([braintunnel-b2b-chat.md](./braintunnel-b2b-chat.md)). For the archived mail-first design and removal of **`runBrainQuery` / `ask_brain`**, see **[archived OPP-106](../opportunities/archive/OPP-106-email-first-cross-brain-collaboration.md)** (**stub:** [OPP-106](../opportunities/OPP-106-email-first-cross-brain-collaboration.md)).
