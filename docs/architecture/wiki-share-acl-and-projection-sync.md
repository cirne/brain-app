# Wiki share ACL ↔ filesystem projection sync order

**Status:** Accepted (design intent for [OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md); implement before relying on **`wikis/@…`** projection as capability-without-read-checks.)  
**Scope:** `wiki_shares` in **`brain-global.sqlite`**, grantee projection under **`wikis/`** (`me/`, **`@handle/`** symlinks); server code paths that accept invites, revoke, and reconcile.  
**See also:** [wiki-sharing.md](./wiki-sharing.md), [OPP-091 § Recommended order](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md#recommended-order-filesystem-vs-database) (OPP summary mirrors this ADR), [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md), [data-and-sync.md](./data-and-sync.md)

---

## Context

Share policy lives in **`wiki_shares`**; grantees observe allowed content through a **materialized symlink tree**. SQLite commits and symlink **`unlink`**/**`symlink`** cannot be merged into one POSIX/ACID primitive. Reads may **not** re-check ACL on every open (accepted product tradeoff: **projection-as-capability**).

### Overriding invariant (fail-safe)

When anything goes wrong (**crash, disk error, partial write, ambiguity between DB and filesystem**), the outcome must prefer **loss of visibility and access** to shared owner data—not **increased** visibility or access. Never widen what the grantee can see relative to **committed** **`wiki_shares`** rows to recover from failures.

Ordering rules and reconcilers **fail closed on ambiguity for the grantee** (temporary missing projection is acceptable; unintended readable paths are not).

Specific goals (instances of that invariant):

1. **Never** leave grantee-visible projection readable **after revoke** longer than unavoidable (narrow in-process window acceptable if **`unlink`** immediately follows DB commit — see **Decision** table).
2. **Never** create a symlink that grants access **without** corresponding committed policy (**no orphan grants**).

---

## Decision

### Source of truth

**SQLite (`wiki_shares` + trusted handle/path metadata)** is authoritative. Projection is **replayable**.

### Preferred operation order (**security-prioritized** under projection-as-capability)

| Operation | Order | Do not… | Caller contract |
|-----------|-------|---------|-----------------|
| **Grant access** (accept invite → live share) | **1.** Commit **`accepted`** (and stable **`share id`**) in SQLite. **2.** Create or repair symlink (temp path + **`rename`** into place when swapping). **3.** On symlink failure → **retry** / reconcile; optionally avoid “browseable” UX until step 2 succeeds. | Create durable symlink **before** the row commits. **Do not** expose success to owner/grantee until **both** policy and projection match **or** you document-only accept with explicit “projection pending”. | Prefer **fail closed** on access until link exists |
| **Revoke** (terminate access) | **1.** Remove projection (**`unlink`** / delete managed mount subtree) **first**. **2.** Commit **`revoked_at`** **only after** unlink succeeds ***or*** treat unlink as gated: if unlink fails → **abort** revoke (caller retries). Alternative acceptable only with read-time denial: DB revoke **commit** immediately followed by **`unlink`** in **same synchronous request** **before responding** — minimize gap. | Prefer **avoid** exposing “revoked OK” **while** symlink still resolves. | Treat dual success (**unlink + COMMIT**) as **mandatory before** signaling success |

`removeWikiShareProjectionForShare` must only **`unlink`** paths whose **`lstat`** shows **`isSymbolicLink()`** (the grantee dentry is a symlink). If an owner has both a **file** share and a **directory** share covering the same subtree, the directory symlink can mask the grantee path so that the resolved object is the owner’s **real file** — **`lstat`** follows pathname resolution and reports a non-symlink; **`rm`** is skipped so owner content is not deleted.

When **creating** projection, **`ensureSymlinkAt`** must not **`stat` + `rm`** along a pathname whose **parent chain** contains a **directory symlink** into the owner vault (that would follow into real files). The implementation walks each path segment under **`wikis/@…/`** with **`lstat` (no follow)** before replace; if the parent chain is blocked, the primary path is skipped and a **`wsh_*`** fallback under the peer root is used instead.

**If revoke runs `unlink` then DB COMMIT fails:** Policy still says accepted; **`reconcile`** may restore symlink — revoke must **retry COMMIT** and/or surface error; surface “revoked” only when both complete.

### Reconciliation

Runs **idempotent** projection from **`wiki_shares`**; repairs missing links (**accept**) and orphan names (**after** policy repair). Mandatory for crash safety and flaky FS. Each sync applies **`ensureWikiShareSymlinkForRow`** to **directory** (`target_kind = dir`) rows before **file** rows so overlapping primary paths can fall back to **`wsh_*`** once parent dir symlinks exist.

### Observability

Log/metric reconcile drift (**DB expects link; ENOENT** / **inverse**). Optionally track projection generation per share.

---

## Consequences

- **Ordering is asymmetric:** grant favors **DB → FS**; revoke favors **FS → DB** (or **COMMIT→unlink→response** tight pairing) depending on smallest leak window consistent with synchronous handler semantics.
- **Fail-safe dominates:** reconcile may restore **missing** links from policy (**brief loss** of visibility) but must **never** manufacture grants beyond policy (**no surprise access**).
- **Tests** spell out failure injections per step (**OPP-091** validation matrix).

---

## Status

Concrete route-level behavior and error codes belong in **`wiki-sharing.md`** as implementation progresses; **this ADR fixes the trust ordering** assumptions.
