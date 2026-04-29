# Ideas

Fuzzy thoughts and concepts that need iteration and refinement before they become tracked opportunities. Each idea captures the problem space, rough direction, and open questions. **When an idea is sufficiently defined**, extract it (or relevant slices of it) into `docs/opportunities/OPP-*.md` and add it to [OPPORTUNITIES.md](OPPORTUNITIES.md).

Idea files live in [ideas/](ideas/). Fully realized ideas move to [ideas/archive/](ideas/archive/).

### States

- **Active** — related opportunities exist and work has begun; the idea is not yet fully realized or shippable end-to-end
- **Backlog** — concept is captured but no related opportunities have been written yet and no implementation has started
- **Graduated** — the idea is fully realized as shippable features; idea file moves to [ideas/archive/](ideas/archive/)

---

## Active


| File                                                        | Title              | Summary                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IDEA-local-bridge-agent](ideas/IDEA-local-bridge-agent.md) | Local Bridge Agent | Lightweight native macOS utility (Rust, ~5MB) that reads local data sources (iMessage, Contacts) and ships them to the user's cloud vault. The cloud is the product; the agent is a courier. Related: [OPP-047](opportunities/OPP-047-cloud-local-connector-tunneled-messages-and-mcp.md). Milestone 1 implemented in-repo — operator validation pending. |


---

## Backlog

Concepts that are captured but have no related opportunities or implementation yet.


| File                                                                                        | Title                              | Summary                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IDEA-enterprise-self-hosted-braintunnel](ideas/IDEA-enterprise-self-hosted-braintunnel.md) | Enterprise Self-Hosted Braintunnel | B2B lane where a company runs their own Braintunnel in their VPC — their LLM keys, their models, license/subscription fee. Two-track GTM: SaaS for individuals, self-managed for orgs that won't use multi-tenant SaaS. Open questions on MVP scope, licensing, and support model. |
| [IDEA-wiki-sharing-collaborators](ideas/IDEA-wiki-sharing-collaborators.md) | Wiki sharing with collaborators (dirs, RW/RO) | Share vault subtrees (e.g. `trips/`) with another user—assistant travel collaboration—read-only or read-write; individuals before groups. First-milestone wedge toward [OPP-042](opportunities/OPP-042-brain-network-interbrain-trust-epic.md); open questions on history, undo, conflicts, implementation. See idea file. |


---

## Graduated

Ideas fully realized as shippable features. Idea file moves to [ideas/archive/](ideas/archive/).


| File         | Title | Shipped As |
| ------------ | ----- | ---------- |
| *(none yet)* |       |            |
