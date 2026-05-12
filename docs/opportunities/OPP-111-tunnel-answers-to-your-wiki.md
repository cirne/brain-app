# OPP-111: Capture tunnel answers into your wiki

**Status:** Open — **fast follow** after **[OPP-110](OPP-110-chat-native-brain-to-brain.md)** (chat-native tunnels) ships core transport + threads.

**Depends on:** [OPP-110](OPP-110-chat-native-brain-to-brain.md) · **Policy context:** [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)

---

## Problem

A natural workflow after **[OPP-110](OPP-110-chat-native-brain-to-brain.md)** is: you asked **Donna’s brain** through a tunnel, got a useful answer, and you want that knowledge in **your** wiki — durable, linkable, consistent with the compounding-wiki story.

That must **not** blur the trust boundary OPP-110 defines: the **remote** restricted agent reads **their** corpus (their wiki, mail, etc. per grant). It does **not** need read access to **your** wiki to answer you, and it must **not** receive write access to **your** vault.

So “put this into my wiki” is a **second step on the asker’s tenant**, not an extra tool on the remote side.

---

## Design principle

| Layer | Who acts | What touches your wiki |
|--------|-----------|-------------------------|
| **Tunnel (OPP-110)** | Remote restricted agent | Nothing of yours — only **text answers** stream back. |
| **Capture (this OPP)** | **Your** app / **your** assistant | **Your** wiki read/write, only after you choose to save or compose locally. |

This does **not** change OPP-110’s fundamentals; it **composes** tunnel output with normal My Brain capabilities.

---

## Directions (not mutually exclusive)

1. **Minimum viable — always possible:** copy from the tunnel transcript; v1 can ship without extra UI.
2. **Save to wiki (or “Add to wiki”):** Client or server action on **your** tenant only — optional path picker, optional title, write markdown derived from selected message(s). Attribution line optional (“From tunnel with @donna, …”).
3. **Continue in My Brain:** One gesture to open a **My Brain** chat with the last tunnel reply (or selection) **attached as context**, so your **full** assistant can expand, merge with existing notes, or place content using existing wiki tools.
4. **Later:** search across tunnel threads, batch export — still local to your tenant.

---

## UX considerations

- **Never** expose wiki tools to the remote tunnel agent for “convenience.” If the user wants their own notes to shape **their next question in the tunnel**, that’s switching back to **My Brain** or reading the wiki themselves — not plumbing their vault into the remote agent.
- **Provenance:** users may want it clear that a paragraph came from **Donna’s brain** via policy-filtered synthesis, not from their own research — optional template in the saved page.
- **Parity with inbound:** the answering side may also want to log **outbound** knowledge locally; that is a separate slice (their wiki, their choice) and can mirror the same patterns.

---

## Technical sketch (light)

- Reuse existing wiki write pathways on the **asker** tenant (same tools the My Brain agent already uses), triggered from UI or from a dedicated **local** agent turn — not from the cross-tenant tunnel RPC.
- Tunnel session rows already store transcript on your side ([OPP-110](OPP-110-chat-native-brain-to-brain.md)); capture actions reference `session_id` + message id(s).

---

## Relationship to OPP-110

Ship **[OPP-110](OPP-110-chat-native-brain-to-brain.md)** first so tunnel threads and final messages exist locally. Then implement this opportunity so “tunnel → my wiki” is first-class without widening the cross-brain trust surface.
