# Ideas

Fuzzy thoughts and concepts that need iteration and refinement before they become tracked opportunities. Each idea captures the problem space, rough direction, and open questions. **When an idea is sufficiently defined**, extract it (or relevant slices of it) into `docs/opportunities/OPP-*.md` and add it to [OPPORTUNITIES.md](OPPORTUNITIES.md).

Idea files live in [ideas/](ideas/). Fully realized ideas move to [ideas/archive/](ideas/archive/).

### States

- **Active** — related opportunities exist and work has begun; the idea is not yet fully realized or shippable end-to-end
- **Backlog** — concept is captured but no related opportunities have been written yet and no implementation has started
- **Graduated** — the idea is fully realized as shippable features; idea file moves to [ideas/archive/](ideas/archive/)
- **Archived** — superseded, closed, or set aside; file stays in [ideas/archive/](ideas/archive/) with **`Status:`** in the doc (not necessarily “shipped end-to-end”)

---

## Active


| File                                                        | Title              | Summary                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IDEA-local-bridge-agent](ideas/IDEA-local-bridge-agent.md) | Local Bridge Agent | Lightweight native macOS utility (Rust, ~5MB) that reads local data sources (iMessage, Contacts) and ships them to the user's cloud vault. The cloud is the product; the agent is a courier. Related: [OPP-047](opportunities/OPP-047-cloud-local-connector-tunneled-messages-and-mcp.md). Milestone 1 implemented in-repo — operator validation pending. |
| [IDEA-brain-query-delegation](ideas/IDEA-brain-query-delegation.md) | Brain-query delegation (B2B fast path) | **Phase 0 shipped (hosted):** `ask_brain`, per-connection **policy + grants**, research + privacy-filter passes, audit log. **Hub / Brain access admin (Spike 1) closed (2026-05)** — [architecture § Hub closure](architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure); epic **[archived OPP-099](opportunities/archive/OPP-099-brain-to-brain-admin-hub-ui.md)**. **Target policy shape:** [architecture/brain-to-brain-access-policy.md](architecture/brain-to-brain-access-policy.md) (draft). **Async approvals + notifications** (review drafted outbound answers): **[IDEA-anticipatory-assistant-brief](ideas/IDEA-anticipatory-assistant-brief.md)** — [architecture § prerequisite](architecture/brain-to-brain-access-policy.md#notification-inbox-and-human-in-the-loop-prerequisite-for-secure-brain-to-brain). **Primary collaboration bet** vs legacy wiki-share expansion — see idea doc. |
| [IDEA-slack-personal-ambassador](ideas/IDEA-slack-personal-ambassador.md) | Slack personal ambassador | Per-user AI ambassador in team Slack; B2B-style draft→review→send over Slack. **Shipped:** [archived OPP-116](opportunities/archive/OPP-116-slack-hello-world-app.md), [archived OPP-117](opportunities/archive/OPP-117-slack-identity-and-messaging-adapter.md). **Active:** [OPP-118](opportunities/OPP-118-slack-ambassador-dm-phase-1.md) (Slack DM delegated assistant + approval). |


---

## Backlog

Concepts that are captured but have no related opportunities or implementation yet.


| File                                                                                        | Title                              | Summary                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IDEA-anticipatory-assistant-brief](ideas/IDEA-anticipatory-assistant-brief.md) | Anticipatory brief + notification/inbox infrastructure | Prioritized **brief queue** (empty chat / home) **plus** cross-surface **notification items**: mail `notify`, collaboration, calendar, wiki, system—and **brain-to-brain** (pending **draft answer review**, send/decline, trust ladder akin to coding-agent approvals). **Prerequisite** for async, human-in-the-loop brain-query UX documented in [brain-to-brain-access-policy.md](architecture/brain-to-brain-access-policy.md). **Persistence shipped:** [archived OPP-102](opportunities/archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md) (`var/brain-tenant.sqlite`); full brief UX still in the idea doc + [chat-history-sqlite.md](architecture/chat-history-sqlite.md). |
| [IDEA-onboarding-insight-gallery](ideas/IDEA-onboarding-insight-gallery.md) | Onboarding insight gallery | Tappable “delight tiles” after mail index warms (subscriptions, trips stitched, replies you owe, etc.): product-curated categories, LLM synthesis on tap—not free-form inbox surprises. Composes with OPP-095 wiki bootstrap; privacy-bounded, eval follow-ups. **Distinct cadence** from [IDEA-anticipatory-assistant-brief](ideas/IDEA-anticipatory-assistant-brief.md) standing queue. No dedicated OPP yet. |
| [IDEA-enterprise-self-hosted-braintunnel](ideas/IDEA-enterprise-self-hosted-braintunnel.md) | Enterprise Self-Hosted Braintunnel | B2B lane where a company runs their own Braintunnel in their VPC — their LLM keys, their models, license/subscription fee. Two-track GTM: SaaS for individuals, self-managed for orgs that won't use multi-tenant SaaS. Open questions on MVP scope, licensing, and support model. |

---

## Graduated

Ideas fully realized as shippable features. Idea file moves to [ideas/archive/](ideas/archive/).


| File         | Title | Shipped As |
| ------------ | ----- | ---------- |
| *(none yet)* |       |            |

---

## Archived

Superseded or closed ideas; the file remains for history and cross-links.


| File                                                                                        | Title                              | Summary                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IDEA-wiki-sharing-collaborators](ideas/archive/IDEA-wiki-sharing-collaborators.md) | Wiki sharing with collaborators (Brain-to-brain collaboration) | **Archived (2026-05).** Peer-to-peer wiki collaboration roadmap **superseded** by **B2B / brain-to-brain query + grants** — **[IDEA-brain-query-delegation](ideas/IDEA-brain-query-delegation.md)**. **Shipped (historical):** [archived OPP-064](opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md); **`wikis/`** — [OPP-091](opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md). |
