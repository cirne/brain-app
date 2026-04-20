# Packaging and distribution trade-offs

This doc compares **how Brain is delivered** (cloud vs native desktop) and what that implies for **onboarding, updates, data access, and security**. It complements [PRODUCTIZATION.md](./PRODUCTIZATION.md) (multi-tenant product blockers) and [VISION.md](./VISION.md) (product arc).

It is a decision aid, not a commitment: both paths can be valid at different horizons.

---

## Summary comparison

| Dimension | Cloud (multi-tenant) | Native desktop (local-first) |
| --- | --- | --- |
| **First-run / onboarding** | Open a URL; **Sign in with Google** (and similar)—low friction for many users | Install binary; **macOS permissions** (FDA, folders); optional OAuth for Gmail/Calendar |
| **Updates** | **Fast, uniform**—deploy and everyone gets fixes on next session | **Slower, uneven**—auto-updater + users who lag; plan support for old builds |
| **Reach & clients** | **Any device** with a browser | **Per-OS** packaging (macOS first; Windows later); **feature matrix** (e.g. no iMessage on Windows) |
| **Gmail / Google Calendar** | **Strong fit**—OAuth and APIs match the “five-minute setup” story | Same cloud APIs **plus** optional local mail/calendar depth |
| **Apple Mail (local)** | Not reading the user’s local Mail store | Can integrate with **on-machine** mail where product scope allows |
| **iMessage / local Apple DBs** | **No** unfettered `chat.db`-class access; different architecture if you need parity | **Differentiator** where FDA/OS allows; high-signal local graph |
| **Local files & folders** | **Upload**, **cloud-drive OAuth**, or **sync client**—extra UX and scope | **Automatic indexing** of user-granted paths; no per-file upload for grounding |
| **Local permission friction** | **None** (no FDA dance) | **Real**—copy, trust, and support burden for disk/folder access |
| **Data residency & trust** | Data on **your** infra; some users want managed backup; others resist “life in the cloud” | Default **on disk**; remote use = **their machine** + tunnel/VPN; local-first story |
| **User isolation** | **Designed and tested**—tenant IDs in every path, worker affinity, no shared mutable roots | **Natural single-tenant** per install—no cross-customer data in one process |
| **Security program** | **Cross-tenant contamination** (storage, caches, RAG, logs, LLM context) is a **shipping requirement** | **Device** and **supply-chain** risk; cross-tenant bleed **not** inherent until multi-account/sync |
| **Ops & economics** | **Scales with tenants**—compute, egress, object storage, backups, abuse | **Binary + updates**; user supplies CPU/power; fewer hosted moving parts per user |
| **Availability** | Can be **always-on** / multi-region (if you invest) | **Mac must be on** (or wake policy); not “open tab anywhere” without remote access setup |
| **Distribution** | **URL** + your hosting | **Notarized DMG**, **MAS**, or both—review, entitlements, release cadence |

The sections below unpack each column with more nuance.

---

## Two archetypes

### Cloud-hosted product (e.g. one container or isolated tenant per user)

**What users experience**

- Open a URL, **Sign in with Google** (and similar) is familiar and low-friction for many people.
- No **Full Disk Access** gate; no local permission dance for Apple’s protected databases.
- The product can push fixes and features **continuously**—refresh the tab or the next session picks up changes.

**What you get technically**

- Email and calendar via **Google APIs** (and other providers) align with the “five-minute setup” story in PRODUCTIZATION.
- You **do not** get unfettered access to **local iMessage** (`chat.db`) or other on-disk Apple silos; Apple does not offer a cloud-equivalent API for that corpus. Anything “iMessage-like” in the cloud is sync, export, or a different product boundary.
- **Arbitrary local documents** (PDFs, notes, project folders on disk) are not automatically visible. Grounding on those files means **explicit upload**, **Drive/Dropbox-style OAuth**, or a **companion sync client**—each adds UX, scope, or security review.

**What you must earn**

- **Multi-tenant security** is a first-class engineering program: storage and DB scoping, cache and embedding isolation, agent/tool context boundaries, logging redaction, and proving that one user’s prompts and retrieved documents cannot **contaminate** another user’s LLM session (including subtle channels: shared workers, buggy path joins, reused connection pools, prompt injection from shared caches).
- **Ops and cost** scale with tenants: compute, egress, backups, abuse, compliance narratives.

**Trust narrative**

- Data is **on vendor infrastructure** (even if encrypted and well-run). Some users will prefer that (managed backups, availability); others will hear “my life is in your cloud” and hesitate—especially for a dense personal wiki and message history.

---

### Packaged desktop app (macOS first; Windows later)

**What users experience**

- **Frictionless** for people already in **Apple Mail and Calendar** when you read local stores or integrations that assume a Mac.
- **iMessage** (where permitted) is a differentiator: a private, high-signal graph that cloud-only products cannot replicate without a different architecture.
- **Local documents** can be **indexed automatically** once the user grants folder or volume access (or a curated set of paths): resumes, research folders, exports, and project files on disk become searchable and citeable **without** uploading each file to a server—strong fit for “my stuff stays on my machine” and for power users with large corpuses they never want in a shared bucket.
- **Full Disk Access** (or other macOS permissions) is real friction: power users understand it; many others will bounce or need careful copy.
- **Distribution**: direct download + notarization, Mac App Store, or both—each has review, entitlement, and update constraints compared to a web deploy.
- **Updates** are slower than “deploy to CDN”: even with a solid auto-updater, users lag on versions; support and schema assumptions must tolerate stragglers.

**What you get technically**

- **Single-user, single-machine** is the default isolation model: you are not holding 10,000 users’ wiki trees in one process unless you deliberately build that.
- **Data residency** is literally the user’s disk; remote access is “their machine, their tunnel/VPN,” which matches a **local-first** privacy story.

**What you still must handle**

- Security does not disappear: **local** threats (malware, unlocked machines, backups, device loss), **supply chain** for the binary, and **safe defaults** for any remote exposure (TLS, bind addresses, session cookies) still matter.
- **Windows** will not replicate the Apple Messages integration; plan for a **feature matrix by platform** so expectations stay honest.

---

## Short term vs long term (how to use this doc)

**Short term** usually optimizes for one of:

- **Learning velocity**: fastest path to validate the core loop (chat + wiki + personal data) with a defined ICP.
- **Wedge**: if the wedge is “knows your iMessage, on-device mail, and **files on disk**,” desktop-local is aligned; if the wedge is “anyone with Gmail in five minutes,” cloud is aligned.
- **Security surface**: shipping multi-tenant cloud **safely** is a schedule item, not a weekend task—budget for threat modeling, tests, and operational controls.

**Long term** does not require picking one forever:

- A **hybrid** is plausible: local app for maximum integration and privacy-sensitive users; cloud tenant for convenience-first users—with **clear** data-boundary documentation.
- Convergence often lands on **shared core** (agent, wiki model, ripmail logic) with **different hosts** (user’s Mac vs your container).

---

## Security: the contamination concern (cloud)

If you pursue cloud multi-tenancy, treat **cross-tenant data bleed** as a product-risk class, not an implementation detail. Non-exhaustive checklist:

- **Storage paths and IDs**: wiki roots, object prefixes, SQLite files—no shared mutable roots without tenant in the key.
- **Process and connection affinity**: background workers, pooled clients, and caches must not serve user A after handling user B without a hard reset or strict partitioning.
- **Retrieval and RAG**: embedding stores, snippet caches, and “recent files” for the agent must be tenant-scoped; add tests that **hammer** two tenants in parallel.
- **Logs and support tooling**: avoid logging bodies of wiki pages or message content; gate exports.
- **LLM context**: system prompts and tool results should never concatenate two users’ corpora; assert invariants in integration tests.

Local desktop does **not** remove all LLM risks (prompt injection from the user’s *own* mail still exists), but it **does** remove “another customer’s mail ended up in my answer” as a class of bug—until you add sync or multi-account features that reintroduce mixing.

---

## Distribution notes (native)

- **Mac App Store** vs **direct/notarized**: Store simplifies discovery and updates for some users; direct distribution often allows faster iteration, different entitlements, and fewer review surprises for agentic features. This is a product and compliance choice, not only engineering.
- **Web** remains the gold standard for “everyone is on the latest build”; native needs an explicit **update strategy** (in-app updater, release notes, minimum version).

---

## Related docs

- [PRODUCTIZATION.md](./PRODUCTIZATION.md) — multi-user blockers, OAuth vision, “alternative path: local-first native app”
- [ARCHITECTURE.md](./ARCHITECTURE.md) — deployment index, single-user assumptions today
- [docs/architecture/runtime-and-routes.md](./architecture/runtime-and-routes.md) — local server, TLS, session model

---

## Open decisions (fill in as you go)

Use this as a living checklist:

1. **ICP for the next release**: who must be delighted first—local power user vs cloud convenience user?
2. **Non-negotiable data sources**: is iMessage in v1, or is Gmail-only acceptable for a cloud slice?
3. **Multi-tenant readiness**: if cloud is on the roadmap, what is the **minimum** isolation milestone before any paid or non-demo tenant?
4. **Update and support policy**: acceptable lag for native clients; how long old builds stay supported.
5. **Hybrid**: intentionally “no hybrid yet” vs “local ingest + optional sync” on the horizon—drives storage design early.
