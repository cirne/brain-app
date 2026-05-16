# OPP-117: Slack identity link + messaging adapter foundation

**Status:** Open

**Parent idea:** [IDEA-slack-personal-ambassador](../ideas/IDEA-slack-personal-ambassador.md)

**Prerequisite:** [archived OPP-116](archive/OPP-116-slack-hello-world-app.md) (hello world Events API, dev verified). **Staging deploy** remains a separate pass when ready — not required to close this OPP.

**Feeds (later OPPs, not here):** ambassador agent, `PolicyEvaluator` enforcement, Block Kit approve/edit/decline, brain-query `source: slack`, Brain Hub digest, attribution footer, channel presence at scale.

---

## Goal

Turn the OPP-116 webhook spike into a **real Slack integration skeleton**:

1. **Identity** — workspace install is anchored to a Braintunnel user; teammates can **link** their Slack account to their Braintunnel tenant (`slack_user_id` ↔ `tenantUserId`, email when available).
2. **Messaging core** — platform-agnostic types + a **Slack adapter** replace the one-off hello-world handler; same hello behavior, but through `MessagingQuery` → adapter → reply.

After this OPP, the server can answer “who in this workspace has Braintunnel?” from **our DB** (not `users.list` of the whole workspace), resolve `@user` mentions in bot DMs, and handle **channel `@mention`** in threads — still with a **fixed hello string**, no LLM or ambassador logic.

---

## Out of scope

- Ambassador / wiki / mail / brain-query pipeline
- Integration-scoped policy, per-contact rules, auto-send
- Block Kit approval flow, modals, App Home content (Home tab optional/off)
- Slack custom status (`users.profile:write` user token)
- Staging Slack app + droplet secrets (defer until deploy — reuse [OPP-116 § Staging](archive/OPP-116-slack-hello-world-app.md))
- Microsoft Teams adapter

---

## Part A — Workspace install + user link

### Product behavior

| Actor | Action | Result |
| ----- | ------ | ------ |
| **Installer** | Braintunnel user with Google session starts “Connect Slack” | OAuth to Slack; store **workspace** (`team_id`, team name) tied to installer’s tenant |
| **Teammate** | Opens link from bot DM or Settings → Connect Slack | User OAuth; if Slack email matches signed-in Braintunnel account (or user confirms), store **`slack_user_id` → tenant** |
| **Anyone** | DM bot: “who has Braintunnel?” (or similar) | Bot lists **linked** users in this workspace (display name from Slack `users.info` when needed) |

**Prerequisite (idea doc):** installer must already have a Braintunnel account — no anonymous workspace installs.

### Slack app configuration (add to dev app `A0B47A43Z7G`)

**Bot token scopes** (keep OPP-116 set; add):

| Scope | Why |
| ----- | --- |
| `users:read` | `users.info` / resolve `@mention` user ids; enrolled-user display names |

**User token scopes** (OAuth link flow):

| Scope | Why |
| ----- | --- |
| `openid` | Sign in with Slack (if using OpenID path) |
| `email` | Match Slack profile email to Braintunnel Google email |

Exact scope set may follow Slack’s current OAuth v2 recommendations; minimize scopes.

**Redirect URLs** (local + prod when known):

- `http://127.0.0.1:3000/api/slack/oauth/callback` (or `PUBLIC_WEB_ORIGIN`)
- Add staging origin when deploying

**App Home:** Messages tab stays on (OPP-116). Optional copy: “Connect your Braintunnel account →” deep link to Settings.

### Data model (direction)

Persist in tenant / global SQLite (exact table names TBD in implementation — prefer reusing connection patterns from Google OAuth / B2B grants):

| Record | Fields (illustrative) |
| ------ | --------------------- |
| **Workspace connection** | `slack_team_id`, `installer_tenant_user_id`, `bot_token` (if not only env), `installed_at` |
| **User link** | `slack_team_id`, `slack_user_id`, `tenant_user_id`, `slack_email?`, `linked_at` |

One Braintunnel tenant may link the same human across **multiple** `slack_team_id`s (idea doc: multi-workspace).

**Security:** encrypt or treat bot token like other secrets; never log tokens. User link requires active Braintunnel session (vault cookie) on callback.

### API / UI (minimal)

- `GET /api/slack/oauth/start` — begin install (installer) or link (user); requires vault session
- `GET /api/slack/oauth/callback` — Slack redirect; public bootstrap path like Google OAuth
- Settings or Hub: **Slack** section — connection status, “Connect” / “Disconnect”, list linked workspace
- Optional: bot DM auto-message on install pointing teammates to link (static text; no LLM)

---

## Part B — Messaging core + Slack adapter

### Platform-agnostic core (`src/server/lib/messaging/`)

Introduce types and a thin dispatcher — **no ambassador agent yet**:

```text
MessagingVenue     — 'dm' | 'private_group' | 'public_channel'
MessagingQuery     — requesterSlackUserId, targetSlackUserId?, venue, text, rawEventRef
MessagingAdapter   — handleEvent(envelope) → MessagingQuery | null; sendResponse(query, text)
```

**Phase-1 stub services** (interfaces only or no-ops):

- `resolveLinkedTenant(slackTeamId, slackUserId)` → `tenantUserId | null` (reads Part A store)
- `listLinkedUsersInWorkspace(slackTeamId)` → for “who has Braintunnel?”

`PolicyEvaluator` / `AmbassadorAgent` / `ApprovalRequest` — **type stubs or comments only**; do not implement policy or LLM.

### Slack adapter (`src/server/lib/messaging/adapters/slack.ts`)

- Move signature verification + event parsing out of `routes/slack.ts` into adapter
- Map `message.im`, `app_mention` → `MessagingQuery`
- Map `MessagingQuery` + hello handler → `chat.postMessage` (thread_ts for mentions)
- **Refactor** [slackHelloWorld.ts](../../src/server/lib/slack/slackHelloWorld.ts) into adapter-driven dispatch; delete or thin legacy path

### Hello-world behavior (unchanged text, richer routing)

| Trigger | Behavior |
| ------- | -------- |
| DM to bot | If text matches “who has Braintunnel” (simple phrase list) → list linked users; else hello string |
| DM with `@otheruser` + question | Resolve `otheruser` via mention markup or `users.info`; if linked, hello that names target (placeholder until ambassador); else “not linked” |
| Channel `@Braintunnel Dev` | Hello in **thread** (`thread_ts`) |

Still **no** wiki/mail/calendar answers — copy makes clear this is infrastructure verification.

### Route shape

- `POST /api/slack/events` — unchanged path; handler delegates to `SlackMessagingAdapter`
- New OAuth routes under `/api/slack/oauth/*` (vault-gated start; public callback)

---

## Code touchpoints (expected)

| Area | Change |
| ---- | ------ |
| `src/server/lib/messaging/` | **New** — types, registry, hello dispatcher |
| `src/server/lib/messaging/adapters/slack.ts` | **New** — adapter |
| `src/server/routes/slack.ts` | Thin delegate to adapter |
| `src/server/routes/slackOAuth.ts` | **New** — install + link |
| `src/server/registerApiRoutes.ts` | Mount OAuth routes |
| `src/server/lib/auth/publicRoutePolicy.ts` | OAuth callback public paths |
| Settings / Hub UI | Slack connection card (minimal) |
| Tenant / global DB | Workspace + user link tables |
| Tests | OAuth state, adapter event → `MessagingQuery`, url_verification regression |

---

## Environment variables

Add when implementing (`.env.example` + [environment-variables.md](../architecture/environment-variables.md)):

| Variable | Purpose |
| -------- | ------- |
| `SLACK_SIGNING_SECRET` | *(existing)* |
| `SLACK_BOT_TOKEN` | *(existing)* or per-workspace token from install record later |
| `SLACK_CLIENT_ID` | OAuth |
| `SLACK_CLIENT_SECRET` | OAuth |
| `PUBLIC_WEB_ORIGIN` | Redirect URI base |

---

## Done when (dev)

1. Installer connects Slack from Braintunnel Settings; workspace row exists for Gamaliel `team_id`.
2. Second Braintunnel test user links Slack; both appear in “who has Braintunnel?” bot response.
3. DM hello + channel `@mention` hello work via **adapter** (not legacy `slackHelloWorld.ts` only).
4. `@mention` of another Slack user in DM resolves to linked/unlinked message (no false positives).
5. Unit tests for adapter mapping + OAuth callback edge cases (invalid state, wrong team).
6. [archived OPP-116](archive/OPP-116-slack-hello-world-app.md) runbook still valid for tunnel + App Home; new scopes documented there or cross-linked.

**Explicit deferral:** staging verification; ambassador Phase 1 ([IDEA § Phase 1](../ideas/IDEA-slack-personal-ambassador.md)).

---

## Verification matrix

| Step | Dev |
| ---- | --- |
| OAuth install → workspace stored | ☐ |
| User link → `slack_user_id` on tenant | ☐ |
| “Who has Braintunnel?” lists linked users only | ☐ |
| DM hello via adapter | ☐ |
| Channel @mention hello (thread) | ☐ |
| Unlinked target @user → clear message | ☐ |

---

## Related

- [IDEA-slack-personal-ambassador](../ideas/IDEA-slack-personal-ambassador.md)
- [archived OPP-116](archive/OPP-116-slack-hello-world-app.md)
- [IDEA-brain-query-delegation](../ideas/IDEA-brain-query-delegation.md) — future `source: slack`
- [google-oauth.md](../google-oauth.md) — redirect URI patterns
