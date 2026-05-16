# OPP-117: Slack identity link + messaging adapter foundation

**Status: Archived (2026-05-16).** **Dev shipped** — workspace OAuth install, per-user link, global SQLite (`slack_workspaces`, `slack_user_links`), Settings Connections Slack card, `MessagingQuery` + Slack adapter (hello-world + who-has + @user linked/unlinked). **Gamaliel workspace verified** via `pnpm run dev:tunnel`. **Deferred:** staging Slack app/deploy; ambassador agent; Block Kit; strict link UX for mismatched emails (see [OPP-118](../OPP-118-slack-ambassador-dm-phase-1.md)).

**Parent idea:** [IDEA-slack-personal-ambassador](../../ideas/IDEA-slack-personal-ambassador.md)

**Prerequisite:** [archived OPP-116](OPP-116-slack-hello-world-app.md) (hello world Events API, dev verified).

**Follow-on:** [OPP-118](../OPP-118-slack-ambassador-dm-phase-1.md) (ambassador DM brain-query + approval flow).

---

## Closure — what shipped (2026-05-16)

| Area | Delivered |
| ---- | --------- |
| **Global DB v11** | `slack_workspaces`, `slack_user_links` in `brain-global.sqlite` |
| **Repo** | `src/server/lib/slack/slackConnectionsRepo.ts` |
| **OAuth** | `GET /api/slack/oauth/start`, `/callback`; `slackOAuth.ts`, `slackOAuthState.ts` |
| **Status API** | `GET /api/slack/connection` |
| **Settings UI** | `SettingsSlackConnection.svelte` on Connections |
| **Messaging** | `src/server/lib/messaging/` — types, hello dispatcher, `adapters/slack.ts` |
| **Events** | `POST /api/slack/events` → adapter (signature + url_verification unchanged) |
| **Env/docs** | `.env.example`, [environment-variables.md](../../architecture/environment-variables.md); OPP-116 operator notes updated |
| **Tests** | Repo, OAuth state/routes, adapter parse, hello dispatcher |

**Dev verified:** OAuth on `127.0.0.1:3000`; Events via `brain.chatdnd.io`; DM hello-world; who-has enrollment query (phrase list expanded during dogfood).

**Not done (explicit deferral):** staging verification; LLM ambassador; `source: slack` brain-query; Block Kit approve/edit/decline; link confirm when Slack email ≠ Braintunnel mailbox; disconnect UI; bot install nudge DM.

---

## Goal (original)

Turn the OPP-116 webhook spike into a **real Slack integration skeleton**:

1. **Identity** — workspace install is anchored to a Braintunnel user; teammates can **link** their Slack account to their Braintunnel tenant (`slack_user_id` ↔ `tenantUserId`, email when available).
2. **Messaging core** — platform-agnostic types + a **Slack adapter** replace the one-off hello-world handler; same hello behavior, but through `MessagingQuery` → adapter → reply.

After this OPP, the server can answer “who in this workspace has Braintunnel?” from **our DB** (not `users.list` of the whole workspace), resolve `@user` mentions in bot DMs, and handle **channel `@mention`** in threads — still with a **fixed hello string**, no LLM or ambassador logic.

---

## Out of scope (original)

- Ambassador / wiki / mail / brain-query pipeline
- Integration-scoped policy, per-contact rules, auto-send
- Block Kit approval flow, modals, App Home content (Home tab optional/off)
- Slack custom status (`users.profile:write` user token)
- Staging Slack app + droplet secrets (defer until deploy — reuse [OPP-116 § Staging](OPP-116-slack-hello-world-app.md))
- Microsoft Teams adapter

---

## Verification matrix (closure)

| Step | Dev |
| ---- | --- |
| OAuth install → workspace stored | ☑ |
| User link → `slack_user_id` on tenant | ☑ (email match required when Slack returns email) |
| “Who has Braintunnel?” lists linked users only | ☑ |
| DM hello via adapter | ☑ |
| Channel @mention hello (thread) | ☐ optional / not dogfooded |
| Unlinked target @user → clear message | ☑ (unit tests) |

---

## Related

- [IDEA-slack-personal-ambassador](../../ideas/IDEA-slack-personal-ambassador.md)
- [archived OPP-116](OPP-116-slack-hello-world-app.md)
- [OPP-118](../OPP-118-slack-ambassador-dm-phase-1.md)
- [IDEA-brain-query-delegation](../../ideas/IDEA-brain-query-delegation.md)
