# OPP-111: Tunnel fast follows

**Status:** Open — **fast follows** after **[OPP-110](OPP-110-chat-native-brain-to-brain.md)** (**archived** 2026-05-12; full spec: [archive/OPP-110-chat-native-brain-to-brain.md](archive/OPP-110-chat-native-brain-to-brain.md)).

**Prerequisite:** [OPP-110](OPP-110-chat-native-brain-to-brain.md) (archived — core tunnel spec) · **Policy context:** [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)

This opportunity bundles **post-v1 tunnel polish** that does not need to ship in the same milestone as the core tunnel cutover, but should be designed as a coherent “second lap”: **(A)** compounding tunnel answers into **your** wiki on the asker side, and **(B)** honest, controllable UX when **others** tunnel **in** to your brain (inbound requests).

---

## A. Capture tunnel answers into your wiki (asker tenant)

### Problem

A natural workflow after OPP-110 is: you asked **another brain** through a tunnel, got a useful answer, and you want that knowledge in **your** wiki — durable, linkable, consistent with the compounding-wiki story.

That must **not** blur the trust boundary OPP-110 defines: the **remote** restricted agent reads **their** corpus (their wiki, mail, etc. per grant). It does **not** need read access to **your** wiki to answer you, and it must **not** receive write access to **your** vault.

So “put this into my wiki” is a **second step on the asker’s tenant**, not an extra tool on the remote side.

### Design principle

| Layer | Who acts | What touches your wiki |
|--------|-----------|-------------------------|
| **Tunnel (OPP-110)** | Remote restricted agent | Nothing of yours — only **text answers** stream back. |
| **Capture (this slice)** | **Your** app / **your** assistant | **Your** wiki read/write, only after you choose to save or compose locally. |

This does **not** change OPP-110’s fundamentals; it **composes** tunnel output with normal My Brain capabilities.

### Directions (not mutually exclusive)

1. **Minimum viable — always possible:** copy from the tunnel transcript; v1 can ship without extra UI.
2. **Save to wiki (or “Add to wiki”):** Client or server action on **your** tenant only — optional path picker, optional title, write markdown derived from selected message(s). Attribution line optional (“From tunnel with @donna, …”).
3. **Continue in My Brain:** One gesture to open a **My Brain** chat with the last tunnel reply (or selection) **attached as context**, so your **full** assistant can expand, merge with existing notes, or place content using existing wiki tools.
4. **Later:** search across tunnel threads, batch export — still local to your tenant.

### UX considerations (wiki capture)

- **Never** expose wiki tools to the remote tunnel agent for “convenience.” If the user wants their own notes to shape **their next question in the tunnel**, that’s switching back to **My Brain** or reading the wiki themselves — not plumbing their vault into the remote agent.
- **Provenance:** users may want it clear that a paragraph came from **another brain** via policy-filtered synthesis, not from their own research — optional template in the saved page.
- **Parity with inbound:** the answering side may also want to log **outbound** knowledge locally; that can mirror the same patterns on **their** wiki (separate from cross-tenant capture).

### Technical sketch (wiki capture, light)

- Reuse existing wiki write pathways on the **asker** tenant (same tools the My Brain agent already uses), triggered from UI or from a dedicated **local** agent turn — not from the cross-tenant tunnel RPC.
- Tunnel session rows already store transcript on your side ([OPP-110](OPP-110-chat-native-brain-to-brain.md)); capture actions reference `session_id` + message id(s).

---

## B. Inbound tunnel UX — send control and a non-misleading chat surface

### Problem

Early inbound implementations may **auto-send** the restricted agent’s reply to the remote peer as soon as it is generated. Productively, the **host** should decide:

- **Auto-send on** (default or power-user): behavior closer to “my brain answered them immediately,” low friction.
- **Auto-send off:** the host **reviews and approves** (or edits) what goes back **before** it crosses the boundary to the requester.

Independently, the **inbound** thread view today risks looking like a **normal My Brain chat** (same composer, same message list patterns). It is **not** the same model:

- Outbound messages are **not** arbitrary “you typed this and it went to Slack.” They are **tunnel replies** constrained by policy, possibly **agent-drafted** first.
- It is unclear to users (and to implementors) what the **composer** means on inbound: does typing **replace** the agent draft? **Append** instructions for the next agent turn? Send **raw human text** instead of an agent answer? **Private notes** visible only on the host tenant?

Without a deliberate model, the UI **lies** — users infer the wrong mental model and may leak or withhold content by accident.

### Proposed directions

1. **Header control: auto-send vs. approve-to-send**
   - Per **inbound tunnel thread** (or per counterparty / global default — TBD): toggle such as **“Auto-send replies”** / **“Review before sending”**.
   - When **off**, agent output stays **pending** until the host confirms (**Send to bridge**, **Approve**, or equivalent). Optional: **Edit** then send, if policy allows editing before egress (define what “edit” means vs. regenerating).
   - Clear states in the transcript: **draft / pending approval / sent / failed** so the host can scan history.

2. **Honest inbound layout**
   - Visually distinguish **their question** vs **your brain’s proposed answer** vs **what actually crossed the tunnel** (after approval).
   - If the composer is **operator input to the local agent** (steer the next reply), label it that way — do not pretend it is “the message they receive” unless it is literally a human-only egress path.
   - If human-only messages to the peer are a **first-class** path, make that explicit (second button, mode switch, or separate strip) so it is never confused with wiki or My Brain side chat.

3. **Open design questions** (to resolve during implementation)

   - **Single composer vs. split:** one field with mode toggle vs. **Draft preview** + **Notes to agent** + primary **Send approved reply**.
   - **Editing agent text:** inline edit of the pending bubble vs. “Regenerate with instruction.”
   - **Notification path when approvals are off:** badge on Inbound, optional desktop/OS notice — out of scope for this doc except “don’t strand pending replies.”
   - **Defaults:** auto-send on for trusted ties vs. off for new tunnel relationships — product policy + [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md).

---

## Relationship to OPP-110

**[OPP-110](OPP-110-chat-native-brain-to-brain.md)** is **archived** (2026-05-12); it defines tunnel threads, message storage, and trust boundaries. Implement this opportunity as a **focused second lap**: wiki capture on the asker side **and** **send gating + UI honesty** on the host side — without widening cross-brain trust or implying vault access the remote agent does not have.
