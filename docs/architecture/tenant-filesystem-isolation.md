# Tenant filesystem isolation (hosted Brain)

**Status:** Strategy — April 2026

## Why this document exists

Hosted Brain keeps the **one tenant, one `$BRAIN_HOME` tree** invariant ([multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)). That model is correct for local-first data and SQLite, but **a single Node process with multiple tenant homes on one host** is unsafe if agent tools can resolve or open **arbitrary absolute paths** with the process’s privileges.

**Historical:** **[BUG-012 (archived)](../bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md)** documented agent-facing tools and app-layer mitigations. **App-layer jailing** (allowlisted roots, wrapped pi wiki tools, `read_mail_message` / `read_indexed_file` / HTTP file read checks) is **partially implemented** as of 2026-04 — see that archive **Progress** section. Kernel / VM / UID layers below remain **future** work for hosted density.

This doc records **five complementary isolation strategies** (kernel, process, and app layers). They are **not mutually exclusive**; production should combine them according to tier, cost, and threat model.

---

## Invariant

- **One user, one brain home** at a time in the cluster (no live replication of a tenant across machines).
- **Every byte** the agent or `ripmail` touches must be **derivable only** from that tenant’s resolved home (and explicitly allowlisted sub-roots such as configured file sources), never from raw model-supplied absolute paths without verification.

---

## Layered strategies

### 1. Micro-container / micro-VM per active tenant

**Idea:** Dedicated compute for each tenant (or small warm pool + cold start). Per-tenant block volume attaches only to that instance; filesystem contains **only** that home at a fixed mount point.

**Scaling:** Long-lived “one VM per user forever” does not scale; **scale-to-zero** micro-VMs (Firecracker-class, regional orchestrators) do. Stable public URL is handled by a **stateless front door** (cookie / JWT → tenant id → machine id or wake).

**Pros:** Strongest isolation; kernel + hypervisor enforce boundaries; app bugs are less likely to cross tenants.

**Cons:** Orchestration, cold-start latency, per-tenant compute floor.

**Pairs with:** Encrypted volumes at rest ([multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md#storage-strategy-network-attached-storage-nas)).

---

### 2. POSIX user per tenant + privilege drop

**Idea:** Map each workspace to a Linux UID/GID; `chown` / `chmod 700` the tenant home; run agent/tool subprocesses (and ideally `ripmail`) **as that UID** (`setuid` child, `systemd-run --uid=…`, etc.). DAC then denies reads of sibling trees under `BRAIN_DATA_ROOT`.

**Density:** Many UIDs per host is normal; the limiter is **RAM** for concurrent tenants, not UID count.

**Pros:** Simple mental model; decades of kernel enforcement; works with explicit `ripmail --home` (or equivalent) without ambient env.

**Cons:** UID lifecycle and provisioning; need **chroot** or careful mount layout so tenants cannot enumerate `/home/*`; Linux-centric.

---

### 3. Linux namespaces + Landlock (per worker)

**Idea:** Tool execution runs in a worker with **mount namespace** (only the tenant tree visible) and/or **Landlock** so syscalls cannot open paths outside an allowlist. Composes with user namespaces for unprivileged outer mapping.

**Pros:** Kernel-enforced jail without full VM cost; high tenant density in one host.

**Cons:** Linux-only; parent process that holds **all** paths must not touch tenant data directly—only delegated workers.

---

### 4. Capability-style I/O: directory FDs, not path strings

**Idea:** After authenticating a request, open the tenant root once; pass a **directory file descriptor** to subprocesses (`dup2` / `posix_spawn` actions) and prefer `openat2` / `*at` APIs with `RESOLVE_BENEATH` (or equivalent) so **path authority** is a handle, not a string the model can forge.

**Pros:** Removes a large class of “wicked path” bugs; aligns with `--home-fd`-style interfaces where supported.

**Cons:** Plumbing every tool and `ripmail` invocation to use roots consistently.

---

### 5. App-layer `Workspace` + proven jail

**Idea:** Single chokepoint: opaque **`Workspace`** (branded type) per request; all FS access goes through `workspace.openRelative(…)` with `resolve` + `realpath` + **prefix proof** under allowlisted roots. **Ban** raw `fs` / `spawn` imports outside that module (lint). **Property-test** and fuzz path inputs (`..`, symlinks, odd Unicode).

**Pros:** Zero ops cost; same code path on macOS desktop and Linux cloud; required for correctness even with stronger layers.

**Cons:** **Insufficient alone** for a hostile code execution scenario (Node RCE defeats it). Does not replace BUG-012 remediation—**implements** the “path canonicalization + allowlist” direction described there.

---

## Recommended composition

| Concern                         | Primary layers                                      |
|--------------------------------|-----------------------------------------------------|
| Mis-routed HTTP session        | Edge router + session binding (existing MT design)   |
| Path logic bugs (BUG-012 class)| **(5)** in progress — shared helpers in `resolveTenantSafePath.ts` / `agentPathPolicy.ts`; OS layers **(2)–(4)** still recommended for defense in depth |
| Subprocess / `ripmail`         | **(4)** explicit home / FD; no ambient `BRAIN_HOME` |
| High-density shared Node       | **(3)** and/or **(2)**                               |
| Strong guarantee / paid tier   | **(1)**                                            |

**Principle:** Let the **kernel** enforce “this process cannot see other inodes,” and let the **app** make it **impossible to express** escapes in normal code paths. The BUG-012 failure mode is exactly “model + tools + absolute paths”; closing it requires **(5)** at minimum everywhere tools touch disk, plus **(2), (3), or (1)** for defense in depth on shared hosts.

---

## Relation to existing guardrails

[Multi-tenant cloud architecture § Tenant isolation](./multi-tenant-cloud-architecture.md#tenant-isolation--security-guardrails) lists zero ambient authority, explicit subprocess args, path jailing, `AsyncLocalStorage`, and encryption at rest. This document **extends** that list with **OS-level and capability patterns** and ties them to the **tracked critical bug** above.

---

## References

- **[BUG-012 (archived)](../bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md)** — historical narrative for agent tool path sandbox / app-layer mitigations.
- [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) — cells, NAS, scaling phases.
- [packaging-and-distribution.md](../packaging-and-distribution.md) — cross-tenant contamination checklist.
- [integrations.md](./integrations.md) — ripmail trust boundaries.
- [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md) — intentional split; security contract for indexed reads.
