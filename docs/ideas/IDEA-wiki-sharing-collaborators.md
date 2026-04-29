# Idea: Wiki sharing with individual collaborators

**Status:** Active — **[OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** is the first concrete step (read-only directory invite, email-as-identity). Write access, agent-scoped reads, handle-based identity, and conflict resolution remain open questions tracked below.  
**Index:** [IDEAS.md](../IDEAS.md)

**Strategic home:** This is a **concrete first milestone** toward the broader **brain-to-brain** vision in [OPP-042: Brain network & inter-brain trust](../opportunities/OPP-042-brain-network-interbrain-trust-epic.md) and the "collaborative wiki spaces" slice in [OPP-001: Agent-to-agent communication](../opportunities/OPP-001-agent-to-agent.md). It does not replace those epics; it names a **user-shaped wedge** (human assistant + travel subtree) that becomes implementable stories starting with OPP-064.

---

## One-line pitch

Let a user **share part of their vault wiki**—by **directory** (preferred) or by **explicit file list**—with **another Braintunnel user**, at **read-only** or **read-write**, the way you share a note in Apple Notes or a doc in Google Docs: **invite an individual**, **revoke anytime**, **clear scope**.

---

## Motivating use case (real)

The owner collaborates with a **human assistant** ("Sterling") on many things, especially **trips**. Sterling should see (and, when allowed, edit) **everything under a designated subtree**—e.g. `wiki/trips/` or `wiki/travel/`—without seeing the rest of the vault.

That single scenario forces the right early questions: **scope** (tree vs files), **permission mode**, **identity of the peer**, and **what happens when two people edit the same markdown**.

---

## Product shape (rough)


| Dimension           | Direction                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit of sharing** | **Directory-first** (inherit to children) is likely as simple as file lists for UX and matches "my travel folder." File-level invites remain valid for tight scopes. |
| **Modes**           | **Read-only** and **read-write** (clear labels; default conservative).                                                                                               |
| **Audience**        | **Individuals first** (one invited Braintunnel identity). **Groups / same access for many** come later and should reuse the same policy object, not a one-off.       |
| **Parity**          | Familiar mental model: **share link / invite** + **access list** + **remove access**—not a public feed.                                                              |


---

## Relationship to inter-brain work

- [OPP-042](../opportunities/OPP-042-brain-network-interbrain-trust-epic.md) already sequences **connection**, **policy**, **wiki path scopes**, **audit**, and later **shared wiki namespaces**. This idea is the **human-facing "share this folder with Sterling"** expression of that policy layer—likely **earlier in the journey** than full agent-to-agent protocol richness, but **must not fork** the trust model (explicit grant, bilateral clarity, audit).
- [OPP-001](../opportunities/OPP-001-agent-to-agent.md) describes **collaborative wiki spaces** as two agents maintaining a shared namespace. **Human collaborators** may be the first shippers of "shared tree" behavior even before every agent-to-agent nicety exists; the **permission and history** rules should still match the same principles.

---

## Open questions (to turn into stories)

Questions marked **OPP-064** are resolved or explicitly deferred in that opportunity. The remaining ones are inputs to future OPPs (write access, agent scope, history).

1. **Concurrency and history** — If two write-capable parties edit the same file, do we rely on **last-write-wins**, **explicit merge**, **CRDT/markdown-aware merge**, or **lock**? How does this relate to [OPP-034: Wiki snapshots & point-in-time restore](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md) and optional **git** in the vault ([PRODUCTIZATION](../PRODUCTIZATION.md) notes git as a possible hosted backing store)? *(Deferred — OPP-064 is read-only.)*
2. **Undo / blame** — "Undo what Sterling's brain did" implies **operation-level history** or **revert**, not only whole-vault rollback. Does the product need **per-file revision history**, **changelog in frontmatter**, or **append-only audit** beside file bytes? *(Deferred — no write in Phase 1.)*
3. **Implementation metaphors** — **Symlinks** (same tree, two mounts), **copy / sync**, **remote mount**, or **server-mediated replication**? Each differs for **offline**, **conflicts**, and **encryption**. Elegant on disk ≠ right for hosted multi-tenant security; [brain-cloud-service](../architecture/brain-cloud-service.md) stresses **no user content at the coordinator**—peer or tenant-scoped replication must preserve that stance. *(OPP-064 uses **server-mediated access** with no data duplication — the owner's files stay in the owner's tenant; the grantee reads through an access-checked API.)*
4. **Agent scope** — When Sterling's assistant runs, its tools must respect **only** the granted subtree on the owner's wiki (mirror of OPP-042 **policy & wiki scoping**). Same for the owner querying Sterling's side if the relationship is reciprocal. *(Deferred — OPP-064 covers human browser access only; agent-tool scoping is a follow-on aligned with OPP-042's policy layer.)*
5. **Read-only vs indexing** — Read-only collaborators must not widen **mail/search** corpus unless separately granted (out of scope for this idea; wiki-only assumption unless stated). *(OPP-064: grantee search stays scoped to their own vault only.)*

---

## Git per user (exploration): backup, rollback, and cost

A natural question: **one Git repository per user** for the wiki vault so **backup and restore** ride on familiar primitives—**commits**, **diffs**, **revert**, **blame**—without inventing a bespoke history layer.

### Why it is attractive

- **Rollback** is a **checkout or revert of a known commit** (or range), not only "replace whole tree from yesterday's ZIP" ([OPP-034](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md)).
- **Audit** for collaboration ("what did Sterling change?") maps to **log / blame** if every write path commits.
- **Off-site backup** can be **push** to a remote the user controls (or we operate), not a second copy format.
- **Reuse** standard tooling (diff viewers, export) for power users who want it.

### What it does to storage and ops (challenges)


| Topic                   | Notes                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disk**                | Each vault is **working tree + `.git/`**. For mostly Markdown, **history dominates over time**: packfiles, reflog (if kept), GC cadence matter. Rough mental model: **more than plain files**, often **2×** or worse until packed—still small per user versus mail corpus, but **aggregate across tenants** matters for sizing.                                                   |
| **One repo per user**   | Clean **isolation** (matches multi-tenant mental model). Costs: **N** repos to GC, snapshot, replicate, and **authenticate** pushes if remotes exist.                                                                                                                                                                                                                             |
| **Hosted product**      | Running **real Git server** (or embedding **libgit2** / porcelain in the app writing to a bare or non-bare repo) adds **auth**, **quota**, **abuse**, and **backup of the repos themselves**. [PRODUCTIZATION § Wiki backing store](../PRODUCTIZATION.md#2-wiki-backing-store-git-friction) already flags this versus "flat files + ZIP / object store + lightweight versioning." |
| **Onboarding friction** | Product vision remains **no git knowledge required**. If Git is **internal only** (automatic commits after edits, Hub shows "timeline" not `git`), users never see `.git`; if we expose remotes/GitHub integration, friction returns—must stay optional.                                                                                                                          |
| **Agent writes**        | Every tool that mutates Markdown should leave a **consistent commit** (debounced batches vs per-call: tradeoffs for history noise vs rewind granularity).                                                                                                                                                                                                                         |
| **Collaboration**       | Shared subtree with another writer ⇒ **merge conflicts**. Git models that honestly; **resolving conflicts for non-developers** is a product problem, not solved by plumbing alone—may still want **locking**, **three-way UX**, or **last-write-wins** policy with conflict copies.                                                                                               |


### How this relates to snapshots (OPP-034)

- **ZIP snapshots** stay the **simple, portable, filesystem-local** baseline: easy to inspect, clone to cold storage, works without Git installed.
- **Git** could **replace or complement**: e.g. **commit-on-lap** alongside or instead of ZIP; or ZIP only as export while **canonical history stays in-repo**.
- Explicit product choice: **Git-first wiki**, **snapshots-first**, or **both** with defined overlap (avoid two divergent truths without reconciliation rules).

---

## References (consistency)

- **[OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** — First concrete step: read-only directory invite, email-as-identity, server-mediated access, no write/agent-scope/handle-registry.
- [OPP-042](../opportunities/OPP-042-brain-network-interbrain-trust-epic.md) — Canonical epic; **scopes** already include wiki paths per connection; OPP-064 is the human-collaborator wedge of M1.
- [OPP-001](../opportunities/OPP-001-agent-to-agent.md) — Collaborative wiki spaces; Sterling appears as an example peer.
- [OPP-034](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md) — Whole-vault backup/restore vs fine-grained collaboration history (see open questions).
- [architecture/data-and-sync.md](../architecture/data-and-sync.md) — Today's wiki is **plain files**, local-first; Git would be an evolution of the backing store, not mandatory for the current model.
- [PRODUCTIZATION](../PRODUCTIZATION.md) — Multi-tenant **isolation** for shared wiki features; [§ Wiki backing store: git friction](../PRODUCTIZATION.md#2-wiki-backing-store-git-friction) — Git vs flat/object-store (**likely answer today** favors simple storage + lightweight app versioning; revisiting **per-user Git** for rollback/diff remains compatible with that section's tradeoff frame).
- [product/personal-wiki.md](../product/personal-wiki.md) — **Private-by-default**; sharing is additive and explicit when it lands.
