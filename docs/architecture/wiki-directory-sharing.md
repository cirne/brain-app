# Wiki directory sharing (Phase 1 / M0)

**Status:** Design direction — aligns with [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) and [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md). Not fully implemented as of this writing.

## Why this doc exists

Brain-to-brain starts with **read-only sharing of a wiki directory prefix** (e.g. `trips/`). This note records **how that should fit “one user, one brain home” encapsulation**: policy and grants live **beside tenant data**, hot paths stay file-shaped, and **authorization remains server-enforced** even when the grantee’s tree uses **symlinks** for tool ergonomics.

---

## Encapsulation: policy in each brain home

**Direction:** Treat share metadata as **files under each tenant’s tree**, not as the only copy of truth in a global app table.

- **Owner (`A`):** Outgoing records (who is invited / accepted / revoked, path prefix, optional exclusions) live in a **small, fixed region**—e.g. dotfiles alongside the shared directory and/or a dedicated folder such as `var/wiki-shares/out/` or `wiki/.brain/shares/out/<id>.yaml` (exact layout is an implementation choice; the invariant is **per-tenant, on disk**).
- **Grantee (`B`):** On accept, **incoming** records live under **`B`’s** tree (e.g. `var/wiki-shares/in/<id>.yaml`) with enough information to open the right owner scope and **repair** broken references after moves or policy changes.

**Listing “my shares”** does not require a special global query for responsiveness: **directory listing APIs** can attach share metadata when listing a folder (colocated dotfile); **incoming and outgoing hubs** can be implemented as **listing that small `in/` / `out/` directory**—the same mental model as browsing files.

**Optional SQLite (or an in-memory index)** may be added later as a **materialized cache** rebuilt from these files (e.g. for operator analytics). It is **not** the conceptual source of truth unless product explicitly decides otherwise.

---

## Grantee view: symlinks vs prefix grants

**Prefix grant (Phase 1):** If the policy is exactly “everything under **`wiki/trips/`**,” the grantee’s integration point is **one symlink** (or mount) at that **granted root** inside **`B`’s** vault namespace—e.g. `wiki/shared/<owner>/trips` → `A`’s `wiki/trips`. That **matches** the policy and avoids symlinking a parent when only a subtree is shared.

**Non-contiguous grants** (holes, arbitrary file sets) would require **many symlinks** or a different mechanism; Phase 1 stays **single contiguous prefix** to keep this simple.

**Symlinks store path strings**, not open file descriptors. **Renames inside** the shared directory **do not** break a **directory-level** symlink to the prefix. **Renames of the granted root** or **per-file symlinks** require **repair** (cold path).

Symlinks must be **created only by the app** after validating policy—never trust arbitrary user-created symlinks for authorization ([tenant isolation](./tenant-filesystem-isolation.md), [BUG-012](../bugs/BUG-012-agent-tool-path-sandbox-escape.md)).

---

## Hot path vs cold path

| Path | Frequency | Expectation |
| ---- | --------- | ----------- |
| **Read / search / open** | High | Fast. Grantee tools (`rg`, read, list) see shared content **through the symlink farm** when present; **every read is still authorized** against current policy (defense in depth—layout convenience is not the security boundary). |
| **Accept invite, revoke, narrow prefix, move granted root** | Low | May be slower; **reconcile symlink layout + manifests** for all affected grantees (“subscribers”). Acceptable to show progress; **retries / repair** (e.g. re-fetch from owner) cover broken references. |

Risk concentrates in **orchestration on policy change**, not in a hypothetical “one `UPDATE` flips everyone” global table—though bugs in reconciliation remain possible; file-backed policy does not remove the need for **correct, scoped enforcement code**.

---

## Implicit widening: new files under a shared prefix

A **live directory grant** means **anything new** under that prefix (owner, agent, external editor, sync) may become visible to grantees **without an extra publish step**.

Mitigations (layered):

1. **Write / move hooks** on agent and server wiki tools: writing or moving into a path that is covered by an **outgoing** share **fails by default** unless an explicit confirmation flag (CLI-style “`--yes`”) or user-approved continuation names the risk (which share / which grantee).
2. **Optional path exclusions** in policy (e.g. share `trips/` but not `trips/_private/**`) so drafts can live outside the visible set without moving trees.
3. **UI affordances:** badge directories that are inside an active share so humans notice they are in a **published zone**.
4. **Optional owner notification** when new files appear under a shared prefix (detection, not primary prevention).

Tool-only friction does **not** cover every writer (e.g. external editors) unless those writes also go through server checks; product should aim for **all wiki write paths** that Braintunnel owns to participate where feasible.

---

## Related

- [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) — Phase 1 product scope, success criteria, API sketch.
- [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) — full vision and later milestones.
- [OPP-034](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md) — vault ZIP; file-backed share metadata may ride in backups differently from purely “app DB only” designs.
