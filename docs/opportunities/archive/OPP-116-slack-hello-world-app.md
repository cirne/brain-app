# OPP-116: Slack hello world app (Bolt + Events API)

**Status: Archived (2026-05-16).** **Dev spike shipped** — Events API on Hono, signing verification, DM hello-world reply in Gamaliel workspace via `brain.chatdnd.io` tunnel. **Deferred:** staging verification (second Slack app + deploy secrets); channel `@mention` smoke test optional.

**Parent idea:** [IDEA-slack-personal-ambassador](../../ideas/IDEA-slack-personal-ambassador.md)

---

## Closure — what shipped (2026-05-16)

| Area | Delivered |
| ---- | --------- |
| **Package** | `@slack/bolt` (+ `webApi.WebClient` for replies) |
| **Route** | `POST /api/slack/events` — `src/server/routes/slack.ts` |
| **Lib** | `src/server/lib/slack/verifySlackSignature.ts`, `slackHelloWorld.ts` |
| **Auth** | Public webhook path (`isSlackWebhookPublicPath`); tunnel GUID bypass for `/api/slack/*` |
| **Dev UX** | `pnpm run dev:tunnel` → `scripts/start-cloudflare-tunnel.mjs` |
| **Test** | `src/server/routes/slack.test.ts` (url_verification + signature) |

**Dev verified:** Slack app `A0B47A43Z7G`, Request URL `https://brain.chatdnd.io/api/slack/events`, DM → `Hello from Braintunnel! (hello-world)`.

**Not done (explicit deferral):** `.env.example` / [environment-variables.md](../../architecture/environment-variables.md) inventory (add with next Slack OPP or staging pass).

**Follow-on:** [archived OPP-117](OPP-117-slack-identity-and-messaging-adapter.md) (workspace + user OAuth link, messaging adapter); [archived OPP-118](OPP-118-slack-ambassador-dm-phase-1.md) (ambassador DM + approval). **Staging verified 2026-05-16** — full DM → integrationAgent → Block Kit → approve → threaded reply with attribution footer working on Gamaliel workspace.

**Slack app operator notes (dev app `A0B47A43Z7G`, OPP-117):** Add bot scope `users:read`; user scopes `openid`, `email`; redirect URL `http://127.0.0.1:3000/api/slack/oauth/callback`; reinstall after scope changes. Events API still requires `pnpm run dev:tunnel` (Slack cannot POST to loopback).

---

## Registered Slack app (dev)

| Field | Value |
| ----- | ----- |
| **App ID** | `A0B47A43Z7G` |
| **Client ID** | `9631143389799.11143344135254` |
| **Dashboard** | [api.slack.com/apps/A0B47A43Z7G](https://api.slack.com/apps/A0B47A43Z7G) |

**Staging app (deployed 2026-05-16):**

| Field | Value |
| ----- | ----- |
| **App ID** | `A0B46M5G46R` |
| **Client ID** | `9631143389799.11142719548229` |
| **Dashboard** | [api.slack.com/apps/A0B46M5G46R](https://api.slack.com/apps/A0B46M5G46R) |
| **Events URL** | `https://staging.braintunnel.ai/api/slack/events` |
| **Interactions URL** | `https://staging.braintunnel.ai/api/slack/interactions` |
| **OAuth redirect** | `https://staging.braintunnel.ai/api/slack/oauth/callback` |

Staging env vars: `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` set on the droplet.

---

## Goal (original)

Prove Slack Events API traffic and a trivial bot reply in-process on Hono — locally (HTTPS tunnel) and on staging.

**Hello world:** DM or `@mention` → fixed hello string. No wiki, mail, tenant, or brain-query.

---

## Shipped code layout

| Piece | Location |
| ----- | -------- |
| Signature + dispatch | `src/server/lib/slack/verifySlackSignature.ts`, `slackHelloWorld.ts` |
| Hono mount | `src/server/routes/slack.ts` → **`POST /api/slack/events`** |
| Registration | `registerApiRoutes.ts` when `SLACK_SIGNING_SECRET` is set |
| Tunnel helper | `pnpm run dev:tunnel` |

---

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| **`SLACK_SIGNING_SECRET`** | Required — Events API verification; enables route |
| **`SLACK_BOT_TOKEN`** | Required for replies (`xoxb-…`) |
| **`SLACK_CLIENT_SECRET`** | Future OAuth install |
| **`CLOUDFLARE_TUNNEL_TOKEN`** | Named dev tunnel → `brain.chatdnd.io` |

---

## Slack app setup (operator runbook)

*(Retained for staging and new workspaces.)*

### Bot scopes

`app_mentions:read`, `chat:write`, `im:history`, `im:write` — reinstall after changes.

### App Home

Messages tab on; **Allow users to send Slash commands and messages from the messages tab**. Home tab optional. Restart Slack client after reinstall if DM composer stays disabled.

### Event Subscriptions

`app_mention`, `message.im` — Request URL `…/api/slack/events`.

### Invite bot to private channel

Channel → **Integrations** → **Add apps**, or `/invite @Braintunnel Dev` — not workspace **Invite people**.

### Staging checklist (deferred)

1. Create staging Slack app; Request URL `https://staging.braintunnel.ai/api/slack/events`
2. Secrets on droplet `.env`; deploy ([DEPLOYMENT.md](../../DEPLOYMENT.md))
3. DM + @mention verification

### Local dev tunnel

```sh
pnpm run dev          # terminal 1
pnpm run dev:tunnel   # terminal 2 — prints Slack Events URL
```

---

## Verification matrix

| Step | Dev | Staging |
| ---- | --- | ------- |
| URL verification green | ☑ | ☐ deferred |
| DM → hello reply | ☑ | ☐ deferred |
| @mention in channel → hello reply | ☐ optional | ☐ deferred |
| Server logs: events, no signature errors | ☑ | ☐ deferred |
| Route off when `SLACK_SIGNING_SECRET` unset | ☑ | — |

---

## Related

- [IDEA-slack-personal-ambassador](../../ideas/IDEA-slack-personal-ambassador.md)
- [OPP-008](OPP-008-tunnel-qr-phone-access.md) — Cloudflare tunnel
- [DEPLOYMENT.md](../../DEPLOYMENT.md)
