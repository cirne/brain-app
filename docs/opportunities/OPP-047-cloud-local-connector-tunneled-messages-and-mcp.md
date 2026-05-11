# OPP-047: Cloud-first brain + local connector — tunneled Messages, periodic upload, and remote query node

**Status:** Active (research; not committed roadmap).  
**Tags:** cloud, security, macOS, Messages, tunnel

## Summary

Many users will prefer a **cloud-hosted** Braintunnel (or hybrid) over installing the full **desktop app**—but **SMS/iMessage** and other data that only exist on a Mac in **`chat.db`** (and local files) remain a **long-term product gap** if we stay purely in the cloud. This OPP captures a **two-part** research direction: (1) a **small, optional macOS utility** the user runs locally that **periodically exports** text-first message excerpts (and selected local files) for **indexing in their cloud brain**, with explicit consent and tight scope; and (2) the same utility (or a sibling mode) as a **remote query node**—when the cloud agent needs **Messages search or thread drill-down**, the call is **routed to the user’s online Mac** (tunnel / WebSocket / MCP-style tool host) so **cleartext never lands in cloud storage** unless the user explicitly chose upload-mode indexing.

The hard problem is not “read `chat.db`” (we already know how, with Full Disk Access); it is **integrating** that capability with a **cloud** identity in a way that is **secure**, **auditable**, and **simple to reason about** for the end user—who must keep the Mac **awake and reachable** for live-query paths.

## Motivation

- **Messages are central** to how people work; excluding them from a cloud-only brain is a **strategic** limitation ([OPP-037](OPP-037-messages-index-and-unified-people.md), [archived OPP-003](archive/OPP-003-iMessage-integration.md)).
- A **full Tauri app** is the wrong onboarding hook for some cohorts; a **lightweight menubar or CLI helper** is easier to adopt if the primary UX is the **web** or **managed cloud** brain.
- **Two legitimate models** may coexist:
  - **Ingestion / search in cloud** — user accepts derived text+metadata in the hosted index (encrypted at rest, strict ACLs). Requires strong **privacy copy**, **retention controls**, and **key management** story.
  - **No cloud copy; tunnel only** — query executes on the Mac; the cloud sees **only** the answer or minimal snippets returned over an authenticated channel. Requires **reliability** when the machine sleeps and **clear UX** when the path is down.

## Proposed research directions

### A. “Uploader” / incremental sync (opt-in, periodic)

- Read-only access to **Messages** (and optional **`localDir`**-style file picks) on the **utility** side; **diff / watermark** to avoid full rescans.
- **Text-first** policy aligned with [OPP-037](OPP-037-messages-index-and-unified-people.md): bodies + thread metadata; **no attachment blobs** by default.
- **End-to-end options** to explore: client-side chunk encryption with keys held in vault/session; **per-brain** ACL in object storage; **wipe** on disconnect.
- **Abuse and consent:** unmistakable “what we upload,” “how often,” “how to delete,” and **Full Disk Access** explanation before enabling.

### B. “Remote query node” / tunnel to desktop (no durable cloud index for Messages)

- The utility maintains an **outbound** secure channel to the user’s **authenticated brain** in cloud (e.g. WebSocket, QUIC, or extension of [OPP-008](OPP-008-tunnel-qr-phone-access.md)-style bring-your-own-tunnel).
- Cloud agent tools like **`search_messages`** / **`get_message_thread`** are implemented as **RPC**: **no local** brain code path in cloud; **request** is forwarded, **result** is returned—similar in spirit to calling an **MCP** server, but with **Braintunnel session identity** and **pairing** so **only** that user’s **paired** node can register for that brain.
- **Pairing and auth:** short-lived device codes, public-key pinning of the local agent, and **re-auth** on long idle; **revocation** from Hub (“disconnect this Mac”).

### C. Hybrid

- **Recent** messages or **only starred threads** uploaded for offline speed; **full history** on tunnel. Reduces “Mac must be up” for common cases while **bounding** cloud retention.

## Security properties (to prove or falsify in design work)

- **Binding:** Cryptographic and account-level proof that a given tunnel/uploader is **the user’s** device for **that** brain only—not a shared token usable across tenants.
- **Least privilege:** Utility runs with **only** the OS permissions it needs; no broad “admin” surface.
- **Data minimization:** Tunnel returns **snippets and structured results**, not whole DB dumps, unless a tool contract explicitly needs more.
- **Observability without leakage:** **Audit log** in cloud of “a Messages tool was invoked” (timestamps, not bodies) for the user; optional **per-session** “always tunnel, never log metadata.”
- **When the Mac is off:** explicit **degraded** behavior—no silent failure; surface “Connect your Mac” or “Enable upload indexing” in product copy.

## Non-goals (for this research note)

- Shipping a second full desktop app; the emphasis is a **small** connector or a **mode** of the existing app slimmed to connector duties.
- **iCloud** or Apple API access we do not control; **on-device** `chat.db` read remains the **supported** path for fidelity ([archived OPP-003](archive/OPP-003-iMessage-integration.md)).
- A legal/compliance sign-off in this file—treat as **R&D and PRD input**.

## Related

- [OPP-037](OPP-037-messages-index-and-unified-people.md) — long-term local **indexing** and unified people.
- [OPP-008](OPP-008-tunnel-qr-phone-access.md) — tunnel/QR/remote access patterns; potential transport baseline.
- [OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md) (archived narrative: [archive/OPP-041](archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md)) — hosted multi-tenant context.
- [Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md) — identity, trust, progressive pairing — may inform **device** trust layers.
- [archived OPP-087](archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) · **stub [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md)** — unified local sources; mail/files vs Messages stay distinct but **query surface** may converge.

## Open questions

- **Naming:** Internal shorthand (“NCP” vs **MCP** / remote **tool** node) should settle before external docs; the capability is a **paired local executor** for brain tools, regardless of wire protocol.
- **Canonical transport:** Reuse existing tunnel stack vs dedicated **outbound agent** connection to Workers—latency, mobile workers, and **sleep** handling.
- **MCP** vs proprietary RPC: if we expose a **local MCP server** for Braintunnel tools, does that increase third-party extensibility, or is it unnecessary attack surface for v1?
- **E2E keys:** user-managed recovery vs cloud **wrapped** keys—tradeoff vs “simple for user.”
- **Windows / non-Mac:** out of scope for Messages; any connector story should not block a future **localDir-only** uploader for other OSes.

## Success criteria (if we invest)

- A **threat model** and **one-page user story** (Happy path + “Mac offline” + “revoke device”) that passes internal review.
- A **spike** proving **sub-2s p95** round-trip for a **bounded** `search_messages` over tunnel on a typical home network (goal, not a promise).
- Clear **decision** between upload index vs tunnel-first vs hybrid for **Messages in cloud**, with a migration path for users who change their mind.
