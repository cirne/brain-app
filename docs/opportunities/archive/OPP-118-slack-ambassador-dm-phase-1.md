# OPP-118: Slack DM — delegated assistant replies and approval (Phase 1)

**Status: Archived (2026-05-16).** **Dev + staging shipped** — integrationAgent + Block Kit approval flow, `b2b_inbound` session with `slackDelivery` metadata, Slack mention→identity resolution, email-mismatch confirm link UX, `POST /api/slack/interactions` route, `eval:slack-integration` JSONL harness. Verified on Gamaliel workspace (dev and staging): DM → Block Kit → Approve → threaded reply with attribution footer. Staging app `A0B46M5G46R` deployed 2026-05-16 (see [OPP-116](OPP-116-slack-hello-world-app.md) for credentials). **Deferred:** channel @mention LLM, admin policy UI, per-contact overrides, auto-send.

**Parent idea:** [IDEA-slack-personal-ambassador](../ideas/IDEA-slack-personal-ambassador.md) *(strategy doc name; product copy uses **assistant** and **tunnel**, not “ambassador”)*

**Prerequisite:** [archived OPP-117](archive/OPP-117-slack-identity-and-messaging-adapter.md) (workspace + user link, `MessagingQuery`, Slack adapter, hello-world routing).

**Feeds (later OPPs, not here):** channel `@mention` delegated replies, admin workspace policy UI, per-contact overrides, presence-aware auto-toggle, Brain Hub digest for Slack-handled turns, AgentExchange, staging deploy pass.

---

## Naming (product vs code)

| Layer | Use | Avoid in user-facing text |
| ----- | --- | ------------------------- |
| **UI / Slack messages / Settings** | **assistant**, **tunnel** (when describing someone reaching another person’s assistant), **Braintunnel** | ambassador, agent, brain-query |
| **OPP / IDEA titles** | “ambassador” OK as strategy shorthand in filenames and [IDEA-slack-personal-ambassador](../ideas/IDEA-slack-personal-ambassador.md) | — |
| **Code — agent** | **`integrationAgent`** (or `channelIntegrationAgent`): dedicated pi-agent for **external channel** intake (Slack first; Teams later). Not `assistantAgent` (main chat) and not `b2bAgent` (Braintunnel↔Braintunnel handles). | `AmbassadorAgent`, exposing “agent” in UI strings |
| **Code — transport** | [`MessagingAdapter`](../../src/server/lib/messaging/types.ts), `slackInbound*`, `source: 'slack'` | — |

**Product vs agent:** Users see **assistant** and **tunnel**; the **integration agent** is an implementation detail — same pattern as `b2bAgent` vs “Tunnels” in the UI.

**Copy examples ([COPY_STYLE_GUIDE.md](../COPY_STYLE_GUIDE.md)):**

- Footer: “Answered on behalf of Alex · via Braintunnel” (not “via Alex’s ambassador”).
- Placeholder to remove: “assistant can answer this soon” / “link your account in Settings” — not “ambassador coming soon.”
- Approval Block Kit: “Review reply from your assistant” / “Send to Slack”.

---

## Goal

Replace hello-world placeholders with a **real delegated-assistant loop** for **DM-to-bot** only:

1. Colleague DMs `@Braintunnel` (or messages the bot) asking about a **linked** user — by name, `@mention`, or implicit self.
2. Server resolves `slack_team_id` + `slack_user_id` → `tenant_user_id`, runs under **`runWithTenantContextAsync`** on that tenant’s home.
3. Draft an answer from wiki + mail + calendar tools (same trust model as in-app **assistant** / B2B owner draft — **review before send**).
4. Owner gets **Block Kit** in Slack to **approve / edit / decline**; on approve, bot posts the reply in the original thread with attribution footer.

This is IDEA Phase 1 narrowed to **bot DMs** — no channel presence, no admin policy editor, no auto-send without approval.

---

## Problems to solve first (dogfood)

| Issue | Direction |
| ----- | --------- |
| **Slack email ≠ Braintunnel mailbox** (e.g. `cirne@gamaliel.ai` vs `lewiscirne@gmail.com`) | Link flow: confirm UI or allow linking when user explicitly confirms; document security tradeoff |
| **Enrollment phrases** | Keep broad “who … braintunnel” matching; avoid false positives on generic “what is braintunnel” |
| **Placeholder copy** | Remove dev placeholder; use assistant/tunnel vocabulary per Naming above |

---

## Product behavior

| Actor | Action | Result |
| ----- | ------ | ------ |
| **Requester** | DM bot: “What does Alex think about the API migration?” with `@alex` or resolvable name | Draft using **Alex’s** tenant context; approval to Alex |
| **Requester** | DM bot about self | Route to requester’s linked tenant if they are linked |
| **Owner** | Tap **Approve** in Block Kit | `chat.postMessage` in requester DM/thread with attribution footer |
| **Owner** | **Decline** | Short “won’t answer” message to requester (no LLM leak) |
| **Unlinked target** | Same as OPP-117 | Clear “not linked” — no LLM call |

**Attribution footer (minimal):** e.g. “Answered on behalf of Alex · via Braintunnel” + link to product.

---

## Technical direction

### Layered architecture

```text
Slack Events API
  → MessagingAdapter (transport: verify, parse → MessagingQuery)
  → Deterministic router (hello, who-has, unlinked — helloDispatcher)
  → Integration agent (LLM: route target tunnel + research + draft)
  → Policy filter (reuse B2B filter prompt / privacy policy where possible)
  → Approval surface (Block Kit + optional Hub notification; source: slack)
  → Adapter sendResponse (chat.postMessage)
```

**Why a separate agent (not “just call b2bAgent”):**

| Concern | Main assistant | B2B agent | Integration agent (new) |
| ------- | -------------- | --------- | ------------------------ |
| **Caller** | Signed-in user in `/c` | Another Braintunnel tenant (handle) | External identity (Slack user id, later Teams) |
| **Routing** | N/A (always self tenant) | Grant + handle lookup | **Channel tools**: resolve linked tenant, pick tunnel target, venue (DM vs channel), enrollment |
| **Tools** | Broad (`createAgentTools`) | `B2B_QUERY_ONLY` corpus subset | **Shared corpus tools** (mail/wiki/calendar — reuse [`agentToolSets`](../../src/server/agent/agentToolSets.ts)) + **channel-specific** tools (no `finish_conversation`, `open`, `speak`, mail compose, etc.) |
| **Output** | Stream to browser | Draft → owner approve → asker session | Draft → owner Block Kit → Slack thread |
| **Reuse later** | — | — | Same agent factory with `channel: 'teams'` + Teams adapter/tools |

Lots of **tool reuse** via `createAgentTools({ onlyToolNames: INTEGRATION_QUERY_TOOLS })` (likely overlaps `B2B_QUERY_ONLY`); **prompts** can fork from `b2b/research.hbs` + `b2b/filter.hbs` with Slack/venue context. **Do not** stuff Slack routing into `assistantAgent` or overload `b2bAgent` with Slack ids — keeps Teams path clean.

### Dispatch (deterministic, pre-agent)

Extend [`helloDispatcher.ts`](../../src/server/lib/messaging/helloDispatcher.ts) (or `slackDelegatedDispatcher.ts`):

- After enrollment / hello / unlinked checks → hand off to **integration agent run** (async, same as today’s schedule pattern)
- Pre-agent resolution (may stay code-only): `targetSlackUserId` from mention, else requester if linked, else fail closed → `runWithTenantContextAsync(ownerTenant)`

### Integration agent (new)

**Suggested home:** `src/server/agent/integrationAgent.ts` (+ `prompts/integration/` or `prompts/slack-inbound/`).

- `createIntegrationAgent({ channel: 'slack', ownerTenantId, messagingQuery, … })`
- Tool allowlist: new group in `agentToolSets.ts`, e.g. `INTEGRATION_QUERY_TOOLS` = corpus (like B2B) + channel tools:
  - `resolve_tunnel_target` / `list_linked_workspace_users` (wrap [`slackConnectionsRepo`](../../src/server/lib/slack/slackConnectionsRepo.ts))
  - `submit_slack_draft_for_review` (or non-LLM: agent returns draft text; server posts Block Kit — prefer **server-owned** approval payloads)
- Session: short-lived per inbound Slack turn (not main-chat `Map`); persist pending approval row keyed by `channel` + `thread_ts` + owner tenant

**Delegation metadata:** `source: 'slack'` on session/notification/grant-analog rows for Hub and analytics (align with [IDEA-brain-query-delegation](../ideas/IDEA-brain-query-delegation.md) over time).

### B2B patterns to reuse (not duplicate)

- Owner **research → filter → review** flow from [`b2bAgent.ts`](../../src/server/agent/b2bAgent.ts) / [`b2bChat.ts`](../../src/server/routes/b2bChat.ts)
- Privacy filter pass before outbound text
- **Not** reusing B2B HTTP routes or asker/outbound session pairing — Slack has its own transport

### Slack interactivity

- New route: `POST /api/slack/interactions` (signing secret, public path like events)
- Block Kit: Approve / Edit / Decline; optional modal for edit
- Scopes: likely `chat:write` (have), `im:write` / `users:read` (have)

### Policy (Phase 1 default only)

- Implement minimal **policy gate** (stub today in [`stubs.ts`](../../src/server/lib/messaging/stubs.ts)): default “review all” for Slack-sourced drafts
- No admin workspace policy UI; no per-contact overrides yet ([IDEA Phase 2](../ideas/IDEA-slack-personal-ambassador.md))

### Link UX

- Settings: show linked Slack email; **Confirm link** when email mismatch
- Optional: `DELETE /api/slack/link` disconnect

---

## Out of scope

- Channel `@mention` delegated replies (keep hello-world in channel until Phase 2)
- Integration-scoped admin policy, per-contact rules, auto-send without review
- Slack custom status sync
- Brain Hub digest UI (stub event/log only OK)
- Staging Slack app + droplet deploy (may run in parallel — see [OPP-116 § Staging](archive/OPP-116-slack-hello-world-app.md))
- **Microsoft Teams implementation** (OPP-118 should **design** `integrationAgent` + adapter boundary so Teams adds `adapters/teams.ts` + Teams routing tools, not a third agent)

---

## Done when (dev)

1. Linked owner receives Block Kit approval for a real DM question about their corpus (wiki or mail cited in draft).
2. Approve posts reply in requester DM; Decline sends safe refusal.
3. Requester targeting unlinked `@user` still gets OPP-117 message — no draft.
4. `source: slack` visible in logs/diagnostics for the turn.
5. User with mismatched Slack/Braintunnel email can link via confirm (or documented workaround removed).
6. No user-facing copy says “ambassador”; `integrationAgent` (or equivalent) exists with channel tool allowlist; unit tests for dispatch + interactions (mock Slack).
7. **Eval coverage** for the integration agent (and any material changes to shared agent/tool code) — see [Eval](#eval) below.

---

## Eval

Follow existing JSONL harness patterns ([`eval/README.md`](../../eval/README.md), [`runAgentEvalCase`](../../src/server/evals/harness/runAgentEvalCase.ts), B2B suites under `eval/tasks/`).

**Done when evals exist and pass locally** (`pnpm run eval:run` Vitest phase + new/extended JSONL, or documented single-suite command):

| Layer | Coverage | Notes |
| ----- | -------- | ----- |
| **Deterministic routing** | Vitest (extend `helloDispatcher.test.ts`, adapter parse) | Who-has phrases, unlinked `@user`, no LLM — not required in JSONL |
| **Integration agent** | **JSONL required** — new suite e.g. `eval/tasks/slack-integration-v1.jsonl` + `runSlackIntegrationEval.ts` / harness case runner | Mock or seed **Slack link + workspace** rows in temp `BRAIN_GLOBAL_SQLITE_PATH`; run agent under owner tenant with Enron/home fixture |
| **Shared agent changes** | Re-run affected suites when touching shared code | At minimum: any change to [`agentToolSets.ts`](../../src/server/agent/agentToolSets.ts), [`tools.ts`](../../src/server/agent/tools.ts), or B2B research/filter prompts → `pnpm run eval:b2b:research` and/or `eval:b2b:filter` still green |
| **Privacy filter** | Reuse or extend `eval/tasks/b2b-filter.jsonl` | Slack-sourced draft text through same filter path as B2B outbound |

**Starter JSONL cases (illustrative ids):**

- `slack-001-dm-resolve-target` — message with `@mention` of linked user → expects `search_index` or `read_mail_message` under **owner** tenant, draft mentions topic from fixture mail.
- `slack-002-unlinked-target` — **no agent run** (dispatcher only); expect deterministic refusal string (Vitest or JSONL `expectNoAgent: true` if harness supports).
- `slack-003-who-has` — enrollment phrase → listed linked users (deterministic; Vitest OK).
- `slack-004-review-gate` — agent produces draft; assert **no** `chat.postMessage` to requester until approval (server-side; may be Vitest on approval store + mock Slack WebClient).

**Reports:** `data-eval/eval-runs/slack-integration-v1-<model>-<timestamp>.json` (gitignored). Optional: wire into `eval:run` pipeline after Enron/wiki when suite is stable ([`package.json`](../../package.json) `eval:run`).

**Not required for OPP-118 close:** LLM-as-judge; full `eval:b2b:e2e` parity; Playwright Slack UI.

---

## Verification matrix

| Step | Dev |
| ---- | --- |
| DM question → draft → owner approval message | ☑ |
| Approve → answer in requester DM + footer | ☑ |
| Decline → polite refusal | ☑ |
| Unlinked @user → no LLM | ☑ |
| Email-mismatch link → confirm path works | ☑ |
| `slack-integration-v1` JSONL (or extended B2B suite) passes | ☑ |
| Shared agent/tool edits: B2B research/filter regressions clean | ☑ |

---

## Related

- [IDEA-slack-personal-ambassador](../ideas/IDEA-slack-personal-ambassador.md) — Phase 1 / 2 breakdown
- [COPY_STYLE_GUIDE.md](../COPY_STYLE_GUIDE.md) — assistant, not agent/ambassador in UI
- [archived OPP-117](archive/OPP-117-slack-identity-and-messaging-adapter.md)
- [archived OPP-116](archive/OPP-116-slack-hello-world-app.md)
- [IDEA-brain-query-delegation](../ideas/IDEA-brain-query-delegation.md)
- [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)
- [eval/README.md](../../eval/README.md) — JSONL harness, Enron seed, B2B eval commands
