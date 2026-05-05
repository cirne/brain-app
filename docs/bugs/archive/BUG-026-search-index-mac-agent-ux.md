# BUG-026: Search index — Mac agent / iMessage setup feels developer-centric; needs data-source parity and guided panel UX

**Status:** Archived (2026-05-05). Hub / Mac agent UX polish deferred; content remains a product reference.

## Summary

On the **local / desktop** Search index (Hub) experience, **Apple Messages via Mac agent** is isolated under **“Connected devices”** while **mail, calendar, and folders** live in the main **data sources** list above. The **Add Mac agent** flow exposes **tokens and optional labels** in a way that reads like **internal admin tooling**, not a consumer product. Non-technical users should not need to understand **access tokens**, **copy/paste setup**, or **one-time secrets** as primary concepts.

**Desired direction:** Treat **Messages (Mac agent)** as **another indexable data source** (same mental model as Gmail or “add folders”), but give it a **dedicated explanation + activation surface** — not a cramped modal — using the same **right-hand overlay / assistant panel** pattern already used for **add folders** (and responsive equivalent on narrow viewports). **Turn it on** should be the obvious primary action; **secure, revocable linkage** should stay **under the hood** and only surface in **plain language** inside the **Apple Messages** integration detail (create + inspect).

## Symptoms (current rough edges)

1. **Information architecture:** **Folders** and **connected accounts** feel like “the index,” but **Mac agent** is **segregated** in **Connected devices** below. That split is **confusing** — users do not naturally bucket “Messages on my Mac” as a **device** vs **Desktop/Documents** as **folders** when both are “things that feed search.”
2. **Technical copy and controls:** **“Create a one-time token,”** **optional label,** and **copy the token** read as **developer setup**. A typical user will not know what a token is or why labeling matters.
3. **Wrong surface for explanation:** A **modal** (or similarly small surface) does not leave room for **what happens**, **why Full Disk Access**, **what we sync**, **how we keep it secure**, and **what you get** (search your messages in Braintunnel, etc.).
4. **Permissions storytelling:** If **Full Disk Access** is missing or fails, the UI should **clearly explain** what broke and **what to do next** in **non-technical** terms — not only a dense paragraph in a settings block.
5. **Feedback after enable:** After the user **turns on** Messages sync, they should **immediately** see **evidence that sync is active** (and not **“Last sync: Never”** with no path to confidence). Align with expectations set elsewhere on the page (e.g. index counts, “Syncing…” style status).

## Expected (product / UX)

### Organization (top down)

- **Rethink the Search index layout** so **Mac agent / Messages** does not feel like an **orphan** under **Connected devices** while **add folders** sits “above” with a **different** metaphor — especially when **both** may depend on **desktop** capabilities or permissions.
- Prefer a **single coherent list or grouping** of **“What feeds search”** (accounts, calendars, local folders, Messages) with **consistent** row patterns and **consistent** “add / manage” affordances — or a **very clear** secondary grouping with a **user-facing** title that matches mental models (e.g. **“Messages on this Mac”** vs **“Other devices”** only if we truly mean **another machine**).

### Mac agent / Messages flow (no token-first UX)

- **Do not** lead with **token** or **label** as the first thing the user sees.
- **Open the same overlay / right panel** used for **folder suggestions** (desktop: side panel; mobile: full-width or bottom sheet as appropriate) with:
  - **Short headline** — what this integration does in one sentence.
  - **What syncs** — plain language (e.g. a **copy** of relevant iMessage data from **this Mac** into **this workspace** for search; avoid implementation jargon unless optional “Details”).
  - **Privacy / security** — **local-first** steps where applicable, **encryption / scope** at a high level, **revocation** explained as **“You can turn this off anytime”** / **disconnect**, not **“revoke token.”**
  - **Permissions** — **Full Disk Access** and **Contacts** (if used for name enrichment) explained as **why the app asks**, not as a spec sheet.
  - **Failure paths** — if FDA is not granted, **actionable** copy + deep link / instructions consistent with existing onboarding gates.
- **Primary CTA:** **Turn on** / **Connect this Mac** (exact label TBD) — performs setup **under the covers** (issue **short-lived or scoped credential**, pairing, or whatever the architecture requires) without asking the user to **copy secrets** unless there is **no alternative**; if copy is unavoidable for a **second device**, relegate to **“Advanced”** or **“Set up another Mac”** with guided steps.

### Inspect / manage existing integration

- **Creating** and **inspecting** **Apple Messages** should land on the **same conceptual page** inside the panel: status, last activity, **disconnect / revoke** in **user language**, and **technical detail collapsed** (e.g. “Connection details” for support).

### Feedback

- After activation, show **clear syncing / healthy** state (timestamps, counts, or phase — whatever is honest and available) so users **trust** the integration without reading logs.

## Fix direction (engineering / design)


| Area               | Direction                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IA**             | Unify or relabel **Connected devices** vs **sources**; align **Messages** with **folder** and **account** patterns; consider moving **Mac agent** into the main list as **“Messages (this Mac)”** with the panel for details. |
| **Surface**        | Replace **modal-first** Mac agent creation with **Hub overlay / right panel** (reuse patterns from **add folders** assistant).                                                                                                |
| **Copy**           | Rewrite all **token / label / ingest** strings for **non-technical** users; keep **revocation** as **user control**, not **crypto jargon**.                                                                                   |
| **Permissions**    | Tie **FDA / Contacts** explanations to **state** (granted / denied / unknown) with **next steps**.                                                                                                                            |
| **Status**         | Ensure **post-enable** UI shows **live or recent sync** feedback; avoid **“Never”** as the default perceived state after a successful setup.                                                                                  |
| **Security model** | Preserve **safe, revocable** credentials internally; **do not** require users to **operate** tokens for the **happy path**.                                                                                                   |


## Verification

- **Manual (desktop):** From Search index, **add Messages** — user never **must** understand “token” to complete **this Mac** setup; panel explains **why** and **what**; **Turn on** works; status shows **syncing / success** without ambiguity.
- **Manual:** **FDA denied** — user sees **clear** remediation, not only a static disclaimer.
- **Component tests** (if applicable): strings / routing for **panel vs modal**; any new **status** fields covered per [docs/component-testing.md](../component-testing.md).

## Related

- Search index / Hub UI (e.g. **BrainHubPage**, sources list, **Connected devices**).
- **BUG-004** (archived): Full Disk Access detection and onboarding — reuse **probe + deep link** patterns where relevant. See [`./BUG-004-full-disk-access-detection-and-onboarding.md`](./BUG-004-full-disk-access-detection-and-onboarding.md).
- **Add folders** flow — **reference UX** for **overlay / right panel** and **non-modal** depth.

## User feedback

Captured from **product walkthrough** (local Braintunnel desktop build, Search index), **2026-04-28**.