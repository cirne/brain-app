# Deployment Models: Desktop vs. Cloud

**Status:** Strategic Decision — April 2026

## Overview

The Braintunnel product will support two primary deployment models: **Desktop (Native)** and **Cloud (Hosted)**. Rather than choosing one over the other, we recognize that each offers structural advantages that cater to different user needs and privacy/convenience trade-offs.

## 1. Desktop (Native)

The "Local-First" flagship. This is the most private and performant version of Braintunnel, running directly on the user's hardware.

### Key Characteristics
- **Privacy:** Data never leaves the machine unless explicitly synced by the user (e.g., via iCloud or manual Git).
- **Performance:** Microsecond latency for SQLite and filesystem operations.
- **Integration:** Deep access to local system resources (iMessage `chat.db`, local files, native notifications).
- **Packaging:** Distributed as a native macOS app (Tauri) and eventually Windows/Linux.

### Use Cases
- Power users who want maximum performance.
- Privacy-conscious individuals who do not want their personal wiki or email index in the cloud.
- Users with large local datasets (terabytes of files) that are impractical to move to the cloud.

---

## 2. Cloud (Hosted)

The "Convenience-First" entry point. A managed service that allows users to try Braintunnel instantly without installing software or managing hardware.

### Key Characteristics
- **Zero Install:** Accessible via any web browser.
- **Always On:** Background tasks (like Ripmail sync) run 24/7 without needing the user's laptop to be open.
- **Multi-Device:** Access the same Braintunnel data from a phone, tablet, or work computer.
- **Managed:** We handle updates, backups, and infrastructure.

### Use Cases
- New users "trying out" the assistant.
- Users who primarily want a 24/7 background agent for email and scheduling.
- Mobile-first users who need access to their wiki on the go.

### Staging on DigitalOcean (April 2026)

**`https://staging.braintunnel.ai`** — TLS at the edge; the Braintunnel container listens on **port 4000** inside the stack. Durable state lives in a **Docker named volume** (`BRAIN_DATA_ROOT=/brain-data`) so **image pulls and container restarts do not wipe data**. Operational detail: [digitalocean.md](../digitalocean.md); milestone closure and **new-host HTTPS checklist**: [OPP-041 (full epic)](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md#reference-https--edge-checklist-new-hosts) ([stub](../opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md)).

---

## The "Both" Strategy

We are building for a world where a user might start in the Cloud and move to Desktop, or use both in a synchronized fashion.

### Structural Advantages
| Feature | Desktop Advantage | Cloud Advantage |
| :--- | :--- | :--- |
| **Data Sovereignty** | Absolute | Managed / Shared Trust |
| **Background Sync** | Limited by laptop sleep | 24/7 Execution |
| **Latency** | Microseconds | Milliseconds (Network) |
| **Connectivity** | Local-only works | Always internet-dependent |

### Future Synchronization
While they start as separate instances, we anticipate a need for:
- **Cloud-to-Desktop Sync:** Moving a "trial" Braintunnel account from our cloud to a local machine.
- **Hybrid Mode:** Running the heavy Ripmail sync in the cloud while keeping the Wiki and Chat UI local.
- **Isolated vs. Synchronized:** Users can elect to run their Desktop app in "Isolated Mode" (no cloud connection) or "Synchronized Mode" (paired with a cloud instance).

## Conclusion
We will maintain a single codebase that can be packaged as a **Tauri Desktop app** or a **Multi-tenant Cloud container**. The core logic (Hono + Svelte + pi-agent-core) remains identical; only the storage and authentication layers adapt to the environment.

**The directory-per-tenant storage model is foundational to this strategy.** For rationale, trade-offs, and defense against conventional SaaS patterns, see [per-tenant-storage-defense.md](./per-tenant-storage-defense.md).
