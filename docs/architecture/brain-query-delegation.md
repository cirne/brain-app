# Brain-query delegation (Phase 0, hosted)

Cross-tenant **natural-language Q&A** with a **database ACL** and **two-pass** answering (research in the owner’s tenant → privacy filter → outbound text only).

**Policy model (target architecture):** [brain-to-brain-access-policy.md](./brain-to-brain-access-policy.md) — three layers (capabilities, hard predicates, soft ALLOW/DISALLOW fragments); Phase 0 remains **one privacy-policy textarea** per grant until **policy-by-reference** ships — see [Denormalized `privacy_policy` on grants (follow-up)](./brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up).

**Hub admin (Spike 1) shipped** under closed **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** — narrative + pointers: [brain-to-brain-access-policy.md § closure](./brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure).

- **Idea / product:** [IDEA-brain-query-delegation.md](../ideas/IDEA-brain-query-delegation.md) · **Notifications / async approval (prerequisite for broader trust):** [IDEA-anticipatory-assistant-brief.md](../ideas/IDEA-anticipatory-assistant-brief.md) · **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** (tenant app SQLite for notification + chat persistence) · [brain-to-brain-access-policy.md § notification](./brain-to-brain-access-policy.md#notification-inbox-and-human-in-the-loop-prerequisite-for-secure-brain-to-brain)
- **Global DB:** `brain_query_grants` + `brain_query_log` in `[brainGlobalDb.ts](../../src/server/lib/global/brainGlobalDb.ts)` (same file as `wiki_shares`; version bump recreates DB per early-dev rules)
- **API:** `POST /api/brain-query`, `GET/POST/PATCH/DELETE /api/brain-query/grants`, `GET /api/brain-query/log?role=owner|asker`
- **Agent tool:** `ask_brain` — see `[brainQueryTool.ts](../../src/server/agent/tools/brainQueryTool.ts)`
- **Settings / Hub UI:** Sharing → **Brain queries** (`[BrainQuerySettingsSection.svelte](../../src/client/components/BrainQuerySettingsSection.svelte)`); Hub **Brain access** (`[HubSharingSection.svelte](../../src/client/components/hub/HubSharingSection.svelte)`, etc.) — see [access policy § Hub closure](./brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure)

## Manual acceptance (two browsers)

Requires `nvm use`, `npm run dev`, two Google accounts with **confirmed handles**.

1. **Donna:** Settings → Sharing → Brain queries → grant access to **@alice** (or Alice’s handle). Optionally edit privacy policy.
2. **Alice:** Chat → ask the assistant: e.g. *Use ask_brain to ask @donna what’s the latest on the construction project* (or equivalent so the model calls `ask_brain`).
3. **Denial:** Third user without a grant should get a clear permission message when calling `ask_brain` or `POST /api/brain-query`.
4. **Audit:** Donna’s inbound log in Settings shows draft vs filtered answer when status is `ok`; Alice’s outbound log shows question + final answer only.

LLM keys must be configured; each research + filter run uses the configured provider/model.

## Captured acceptance (automated)

As of implementation, the following are covered by unit/integration tests (run `nvm use && npx vitest run`):

- **Grants + log repos:** create/list/revoke/edit, unique `(owner_id, asker_id)`, default policy seed.
- `**runBrainQuery`:** `denied_no_grant`, revoked grant, happy path with stubbed agents, filter redaction, `filter_blocked`, log rows per outcome.
- **HTTP:** `POST /api/brain-query` and grant/log routes (auth + shape); route tests mock `runBrainQuery`.
- `**ask_brain` tool:** handle resolution and denial/error text for the calling agent.
- **Settings UI:** `[BrainQuerySettingsSection.test.ts](../../src/client/components/BrainQuerySettingsSection.test.ts)` (grants + inbound/outbound log views).

The two-browser redaction spot-check (`$47,500` → vague amount in the answer) still depends on running the manual steps above with real mail + LLM.