# OPP-028: Named Assistant Identity and the Living Avatar

**Tags:** `desktop` (includes dock, window title, and native chrome affordances) — **Short-term priority:** [cloud / hosted](../OPPORTUNITIES.md) before deeper native-only visual polish.

**Context (2026):** The app’s **public product name** is **Braintunnel** (see M0, [OPP-043](OPP-043-google-oauth-app-verification-milestones.md)). This OPP is **not** about renaming the app again; it is about a **user-chosen assistant identity** (name + avatar) that appears *inside* the product beyond the “Braintunnel” chrome.

## One‑line summary

Add a **personalized, named assistant** that every user **co‑creates** during onboarding—proposed by the **same profiling agent** that built `wiki/me.md`, via structured `**suggest_assistant`** tool calls that reuse that context, persisted in `**wiki/assistant.md**` (companion to `me.md`), given a **consistent illustrated avatar**, and brought to life through **daily contextual variations** (weather, birthdays, holidays, the user's interests). The assistant becomes a **character**, not a product.

## Why this exists

**Braintunnel** is the app; a **character layer** (name + face) is still optional. The long-term bet is a **deeply personalized assistant** that already knows the user's mail, people, projects, and writing style by the time they finish onboarding. That intimacy deserves a named, faced counterpart—something the user **calls by name**, not only "the assistant" or the app title "Braintunnel."

Two related pressures push this from "nice rebrand" to "structural change in how the product talks about itself":

1. **Generic AI naming has lost its emotional power.** Alexa, Siri, Gemini, Claude, Copilot—every household name in this category is a brand identifier. A *personal* assistant should not share its name with a million other instances. The name should be **earned from this user's data**, not assigned by a marketing team.
2. **The data is already there.** By the time the user reaches the post‑profile step in current onboarding ([OPP-006](./OPP-006-email-bootstrap-onboarding.md)), `wiki/me.md` is a factual, structured one‑page profile derived from thousands of indexed emails using real tool calls (`find_person`, ripmail search, wiki writes). A naming step at this point is **not** a personality quiz from cold start—it is **synthesis** of signal that already exists. That changes feasibility.

## Vision

The profiling agent has already **reused the same mail/wiki context** for `me.md` and for `**suggest_assistant`** tool calls. After the **join**—profile accepted **and** suggestions ready—they meet **their assistant** for the first time:

> *"Based on what I learned about you—platform builder, ministry co‑founder, family of six, splits time between Texas and Cabo—here are some names I think might fit. Each one comes from something specific in your story:"*
>
> - **Dirac** — honors your platform‑building legacy at New Relic; technical, fundamental, a builder's name
> - **Vela** — constellation and sail; navigational, purposeful, guides across tech, ministry, and family
> - **Caelum** — sky in Latin; bridges your technical and spiritual worlds
> - *…five to ten options, with a custom write‑in always available*

The user picks. An **illustrated avatar** is generated in their chosen visual style. From that moment on, **the assistant layer speaks in that name**: top nav, chat avatar, notifications, system messages. The app may still show **Braintunnel** as the product (title bar, OAuth) while the user talks to **Corvin**, **Kalem**, or **Dirac**.

And then—the part that turns the character into a relationship—**the avatar is alive**. Same face, same hair, same Corvin. But on a cold day she's wearing a scarf. On the user's birthday there's a small party hat. During Game 7 of the user's hockey team's playoff run, she's wearing the jersey. None of this is announced or gamified; it is just **what Corvin happens to be wearing today**.

## Why this matters product‑wide

This is **not** an onboarding feature with cosmetic rebrand attached. It is a **product positioning shift** that ripples outward.

### What changes


| Surface                                                                                                         | Today                                                           | After                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App vs assistant (visible)**                                                                                 | "Braintunnel" (app) + generic "Assistant" in some chrome          | The user's chosen **assistant** name and avatar; **Braintunnel** remains the app/product name (OAuth, marketing, system).                                                                                                                                                                                                                                                                             |
| **Onboarding**                                                                                                  | `not-started → indexing → profiling → reviewing-profile → done` | `not-started → indexing → profiling → reviewing-profile → **naming-assistant** → **avatar-style** → done`. Profiling **does not end** when `me.md` is written: the agent continues with `**suggest_assistant` tools** while the user reviews; **naming-assistant** unlocks only when **both** profile accept and suggestions are ready (see *Race* below). Avatar generation can complete in background. |
| **Top nav identity**                                                                                            | Generic title / brand mark                                      | The assistant's avatar + name                                                                                                                                                                                                                                                                                                                                                                            |
| **Chat UI**                                                                                                     | Assistant messages render as "Assistant" / generic chrome       | Assistant messages render with **Corvin's avatar**, voice attributed to Corvin                                                                                                                                                                                                                                                                                                                           |
| **System prompt**                                                                                               | Single generic agent persona                                    | **Personality variant** is injected per the user's name selection (warm vs direct, formal vs casual) so behavior matches the chosen identity, not just the label                                                                                                                                                                                                                                         |
| **Settings** ([OPP-021](./OPP-021-user-settings-page.md))                                                       | n/a                                                             | "About Corvin" section: rename, regenerate avatar, change personality preset                                                                                                                                                                                                                                                                                                                             |
| **First chat** ([OPP-018](./OPP-018-first-chat-post-onboarding-prompt.md))                                      | "I'm Brain, here's what I know about you…"                      | "I'm Corvin. Here's what I learned in your mail this week…" — the introduction *is* the name landing                                                                                                                                                                                                                                                                                                     |
| **Cross‑user language** ([OPP-042](./OPP-042-brain-network-interbrain-trust-epic.md), [OPP-001](./OPP-001-agent-to-agent.md), [OPP-002](./OPP-002-public-brain-identity.md)) | "your brain talks to my brain"                                  | "Corvin will reach out to Kalem on your behalf"—agent‑to‑agent gains social texture because each instance has a name                                                                                                                                                                                                                                                                                     |
| **Marketing / public**                                                                                          | "Braintunnel is your local assistant"                           | "Braintunnel gives you **your** assistant—Corvin, Kalem, whoever they turn out to be." Brand‑level promise: app + *your* character.                                                                                                                                                                                                                                                    |


### What stays the same

- **Internal architecture, codebase, repo names**: Brain remains the codename. `brain-app`, `BRAIN_HOME`, the Tauri app bundle—all unchanged. This is purely a **user‑visible naming layer**.
- **Core agent runtime and ripmail**: Same stack. **Profiling gains new tools** (`suggest_assistant`, optional `assistant_suggestions_complete` or equivalent) and **wiki gains `assistant.md`**. Identity is **primarily wiki-backed** (`assistant.md` + optional `assistant.json` for asset paths).
- **Onboarding pipeline up to profile draft**: Existing flow intact through **first `me.md` write**. After that, profiling **continues in parallel** with review (see below). The naming step **slots in** after **both** profile accept and assistant suggestions are ready, then wiki seeding / main app handoff.

## Profile builder: one agent, two phases (reuse context)

The **profiling agent** already gathered mail/wiki context and produced `wiki/me.md`. The best naming pass is **not** a separate cold LLM round-trip—it is **the same session**, **same tool budget**, **same working memory**.

### Phase A — Build the user profile (today)

1. Gather data (search/read mail, wiki, `find_person`, etc.).
2. Write `me.md` (draft or temp until accept).

### Phase B — Suggest assistants (new, same run)

1. **Do not terminate the profiling stream** when `me.md` first lands. Transition the **UI** to "Review your profile" so the user can read and edit—but the agent **keeps running**.
2. The agent issues **multiple `suggest_assistant` tool calls** (one candidate per call, or batched—implementation detail). Each tool result is a **small structured record**, for example:

  | Field             | Meaning                                                                                                                                            |
  | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `name`            | Proposed assistant name                                                                                                                            |
  | `sex`             | `male` | `female` — **MVP**: binary only so avatar + voice copy stay simple; expand later to non‑binary / unspecified with broader product support |
  | `style_one_liner` | One line: how this assistant shows up (tone, cadence) — maps to system‑prompt variant                                                              |
  | `rationale`       | One sentence tying the name to **this user's** `me.md` / mail signals — **required** (no rationale → reject or regenerate)                         |

3. Target **8–10** suggestions across variety (nature, classical, technical, modern—invented)—same diversity goals as before, but **materialized as tool outputs** the client can render as cards as they arrive (streaming UX).

**Why tools instead of one JSON blob:** Observability, partial progress (user sees names trickle in), easier server-side validation (pronounceability, blocklist), and alignment with how the rest of onboarding already surfaces tool calls.

### Race: user vs agent

Two independent completions must both be true before showing the **pick your assistant** screen (or enabling its primary CTA):


| Gate                  | Meaning                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile accepted**  | User clicked **Looks good** (or equivalent); `me.md` is committed as today.                                                                     |
| **Suggestions ready** | Profiling agent finished emitting enough `suggest_assistant` results (e.g. ≥ N candidates, or agent signaled `assistant_suggestions_complete`). |


**UI behavior:**

- While on **review**: show profile editor as today; **also** show a compact status row: e.g. "Still preparing name ideas…" with a subtle pulse until suggestions are ready (or an error state with retry).
- If the user is **fast** (accepts before suggestions finish): transition to **naming-assistant** with a **blocking loader** until suggestions arrive—or keep them on a thin interstitial. **Do not** show an empty picker.
- If the agent **finishes first**: user can still read/edit `me.md`; picker stays disabled until accept.
- When **both** ready: enable **Continue to name your assistant** (or auto-advance—product choice).

This is a deliberate **join**, not a bug: we avoid forking two LLM pipelines that disagree about the user, and we avoid blocking review on a long second phase.

### After pick: `assistant.md` + avatar

1. User selects one suggestion (or write‑in—still allowed).
2. **Write `wiki/assistant.md`** — the **companion** to `wiki/me.md`: canonical name, sex/presentation, style one‑liner, rationale, chosen vs suggested, avatar asset references when ready. The main agent should read **both** files for identity (same pattern as `me.md` injection today).
3. **Kick off** illustrated avatar generation (non‑blocking) + optional `assistant.json` under `BRAIN_HOME` if runtime needs paths outside the wiki—**wiki is source of truth for "who is my assistant"**; JSON is cache/IO convenience.

**Naming note:** The product today uses `**wiki/me.md`** for the user profile, not `user.md`. This OPP standardizes on `**wiki/assistant.md**` as the assistant's durable page; avoid introducing `user.md` to prevent two names for the same thing.

## How the naming step works (picker + fallbacks)

### Inputs (in priority order)

1. `**suggest_assistant` tool results** from the profiling run — primary; grounded in the same context as `me.md`.
2. `**wiki/me.md`** — for display copy and validation that rationale still matches after user edits (if `me.md` changed materially before accept, optional re-run of suggestion tail—see *Risks*).
3. **Onboarding fallback** — only if suggestions are thin or failed: curated catalog + write‑in (Tier 3).

### Alternate: separate naming endpoint (fallback)

If the unified profiling run fails to produce suggestions in time, a `**POST /api/onboarding/assistant/suggest-names*`* that reads committed `me.md` can backfill—same schema as tool results. Prefer not to rely on this in the happy path.

### LLM shape (when not using tools for a fallback)

A single LLM call can still **extract identity vectors** and **emit 8–10 candidates** with rationale (same list as before). Use only when the tool-based path did not complete.

### UI shape

A clean selection screen. Each row/card maps 1:1 to a `**suggest_assistant` tool result**:

- **Name** (large, prominent)
- **Rationale** — one sentence, user-visible ("Because you do X…")
- **Style one‑liner** — from the tool; may be expanded in UI to a short blurb, but the contract stays one line for prompt mapping
- **Sex** (MVP: male / female) — drives default avatar generation and optional pronoun copy until broader options ship
- Optional: pronunciation hint for unusual names

Three actions:

- **Pick this name** (primary)
- **Show me more options** (secondary; one re‑roll, then the user is encouraged to commit or write in their own)
- **Name it myself** (always available, never buried)

### Personality matters: the name is not a skin

If the only thing that changes when the user picks "Corvin (warm, contextual)" vs "Dirac (terse, technical)" is the chrome, savvy users will feel it within a few sessions and the rebrand becomes hollow. **The personality blurb shown at selection time must map to a real system‑prompt variant** that affects behavior:

- **Warm / contextual**: more pleasantries, more clarifying questions, longer answers with framing
- **Terse / direct**: minimal preamble, bullet‑heavy, assumes the user knows the domain
- **Curious / proactive**: more likely to volunteer related context the user didn't ask for
- *(Initial set kept small; expand as we learn what users gravitate to.)*

This is a small, contained system‑prompt change—no architectural lift—but it is the difference between a meaningful product feature and a marketing exercise.

## How the avatar works

### Initial avatar: illustrated, not photorealistic

**Photorealistic AI portraits are a trap for this product.** They are slow (15–30s), inconsistent, and risk uncanny valley—especially for the friendly, professional, non‑sexualized presentation we want. One slightly off render destroys the moment. They also make daily variation (next section) effectively impossible.

**Commit to an illustrated style** that is:

- Distinctive but warm; clearly a character, not a stock figure
- **Composable from the start**: base figure + hair + face/expression + clothing layer + accessory layer + background layer
- Visually consistent across users (Corvin and Kalem live in the same illustrated world even though their faces differ)
- Generation‑friendly: producible by an image model with a strong style anchor (reference image, LoRA, or curated prompt template)

The user's avatar is generated **once** during onboarding, **after** the user picks the name (so the avatar can match the personality). Generation is **non‑blocking**: the user can advance to the main app immediately; the avatar streams in over the next 30–60 seconds with a tasteful placeholder silhouette in the meantime.

### Daily variations: the living avatar

This is the part that turns a character into a *presence*. Same Corvin every day—same face, same hair, same general shape—but small contextual changes that feel like a real person noticing the world:


| Signal                                                         | Variation                                          |
| -------------------------------------------------------------- | -------------------------------------------------- |
| **Cold day** (weather API + location)                          | Scarf, sweater, snowy backdrop                     |
| **Hot day**                                                    | Lighter clothing, sunglasses                       |
| **Rainy day**                                                  | Umbrella, raincoat                                 |
| **User's birthday** (from `me.md` / calendar)                  | Subtle party hat                                   |
| **Major holiday** (locale‑aware, *not* default Western)        | Festive backdrop appropriate to the user's culture |
| **Friday**                                                     | Subtly more casual outfit                          |
| **Monday morning**                                             | Coffee cup                                         |
| **User's favorite team in playoffs** (from email/wiki signals) | Team jersey or scarf                               |
| **Travel mode** (calendar shows user is away)                  | Different backdrop, suitcase                       |
| **Seasonal**                                                   | Falling leaves, cherry blossoms, beach umbrella    |


The mechanism that makes this **fast, reliable, and on‑brand** is **layered composition**, not per‑day image generation:

1. The illustrated avatar is built from a defined layer stack (SVG / sprite layers).
2. A **curated asset library** holds clothing, accessory, and background overlays in the same illustrated style.
3. Each morning (or on app open), a tiny LLM call—or even pure rules—reads today's context signals and decides **which overlays apply**.
4. Rendering is **deterministic composition**: zero latency, zero quality variance, no daily AI image cost.

This avoids the catastrophic failure mode of "Corvin looks slightly different every day because the model regenerated her." Consistency is the brand; the overlays are the seasoning.

### Discipline that keeps it from feeling gimmicky

- **No notifications about outfit changes.** The user notices or they don't. Restraint is what makes it feel real.
- **No badging, achievements, or streaks.** This is not gamification.
- **Cultural awareness, not Western default.** Holiday overlays key off the user's inferred locale and cultural context (`me.md` carries this signal). A user in Riyadh does not get Christmas decorations on December 25.
- **A toggle to disable contextual variation entirely.** Some users will want a static avatar. Honor that.

## Tiered feasibility (honest read)

This is the pattern from the Brain‑written feasibility analysis, restated in the same shape we use elsewhere in this repo:

### Tier 1 — Rich data users (~70–80%)

Active professionals with diverse mail history. `me.md` synthesizes cleanly. Naming candidates feel earned; the avatar context signals (sports teams, travel, etc.) hit. **Goal: >60% pick an AI suggestion** (vs. write‑in). Quality bar: at least one suggested name produces a small "huh, that's actually right" moment.

### Tier 2 — Moderate data users (~15%)

Corporate‑heavy mail, low personal signal. `me.md` is real but less distinctive. Naming step **supplements** with one or two onboarding questions to get richer input. Result: 6–8 serviceable names. User may write in their own; that's fine and honored.

### Tier 3 — Sparse data users (~5–10%)

Gen Z (text‑primary), heavy privacy users (burner accounts, no subscriptions). The honest path is **don't pretend**. Lead with the onboarding questions, offer a curated catalog organized by vibe ("calm and grounded," "playful and curious," "precise and direct"), and let the user pick or write in. The avatar still works; the daily variations still work. The naming feels less "this app reads my soul" and more "this app helped me pick something I like." That is fine.

The product disaster to avoid: pretending Tier 3 is Tier 1. If the LLM has nothing to work with and bluffs a confident rationale, the user notices. Better to say "you're a private person—here are some names I think work for someone who keeps things contained" than to fabricate a story from receipts.

## Onboarding flow, end to end

Existing states ([OPP-006](./OPP-006-email-bootstrap-onboarding.md)) evolve as follows. `**reviewing-profile` overlaps profiling phase B** (assistant suggestions).

```
not-started
  → indexing
  → profiling            [phase A: me.md + phase B: suggest_assistant tools — same SSE session]
  → reviewing-profile    [user edits me.md; agent may still be streaming suggestions — JOIN with profile accept]
  → naming-assistant     [NEW — shown when: profile accepted AND suggestions ready]
  → avatar-style         [NEW; non-blocking, can complete in background]
  → done
```

**Client state (conceptual)** — orthogonal booleans, not necessarily separate routes:

- `profileAccepted`
- `assistantSuggestionsReady` (count ≥ threshold or server signaled completion)
- `**canShowAssistantPicker`** = `profileAccepted && assistantSuggestionsReady`

### Inside `reviewing-profile` (overlap)

1. User sees `me.md` in the editor (today).
2. Same profiling stream continues: `**suggest_assistant` results** appear in the activity panel / transcript (reuse onboarding activity UI patterns from `OnboardingProfilingView.svelte`).
3. Status copy makes the join explicit: e.g. "Review your profile" + "We're still preparing name ideas…" until suggestions catch up—or "Name ideas ready — continue when your profile looks right."

### `naming-assistant` step

1. **Precondition:** `canShowAssistantPicker` (see *Race* above). Data is already on the client from tool results; server mirrors in session or onboarding store.
2. UI: grid of cards from `**suggest_assistant`** rows; pick / re‑roll (optional second agent tail) / write‑in.
3. On selection: **write `wiki/assistant.md`**, merge chosen row + user overrides; kick off avatar generation; persist `**assistant.json**` if needed for image paths outside git.
4. Advance to `avatar-style` (or skip straight to `done` if avatar is fully async—product choice).

### `avatar-style` step

1. Show 2–3 illustrated style options (e.g. "warm flat illustration," "soft watercolor," "minimal line art")—same character archetype, different stylistic treatment. This gives the user agency without forcing them to art‑direct.
2. On selection: kick off avatar generation (single image model call with a strong style anchor + name + gender/pronoun + brief personality cue).
3. **Do not block.** Advance to `done`. Avatar appears with a placeholder silhouette and fills in within 30–60 seconds.
4. After avatar arrives, build the layered composition record (separate face, hair, clothing slots) so daily variations work from day one.

### Failure modes

- **Profiling phase B fails / times out**: backfill via `POST …/suggest-names` from committed `me.md`, or curated catalog + write‑in. Never block onboarding.
- `**me.md` edited heavily after draft**: suggestions may be stale; optional **re-run** of phase B from accepted `me.md` (single LLM pass or short agent continuation)—product decides cost vs freshness.
- **Avatar generation fails**: keep the silhouette placeholder; offer a "regenerate" affordance in settings. The user can use the product without an avatar; do not gate.
- **User declines naming entirely**: assistant gets a sensible default (e.g. "Assistant," with the user's profile name as fallback). Encourage but never require.

## Product language: rename audit

Before this ships, a sweep is required across all user‑visible copy where "Brain" appears today:

- **Onboarding screens** (`OnboardingWorkspace.svelte`, `OnboardingProfilingView.svelte`, lead copy in `onboardingLeadCopy.ts`)
- **Wiki product doc** (`docs/product/personal-wiki.md`) — wording shifts from "Brain helps you maintain…" to "your assistant helps you maintain…"
- **App chrome** (top nav, page titles, window title)
- **System prompts** (assistant self‑reference)
- **Marketing surfaces** ([PRODUCTIZATION.md](../PRODUCTIZATION.md), [VISION.md](../VISION.md))
- **Settings** ([OPP-021](./OPP-021-user-settings-page.md)) — first‑class "About your assistant" section

The repo, codename, internal docs, env vars (`BRAIN_HOME`), and process names **stay**. This is a **user‑visible** rename, not a refactor.

A separate, smaller piece of work is to **decide what the umbrella product is called** publicly. The user gets *their* assistant (Corvin), but there is still a product they downloaded. Options:

- Keep "Brain" as the umbrella ("Brain gives you Corvin")
- Rename the umbrella and let the assistants be its instances
- Lean fully into "your assistant has a name; the app does not need one prominent in the UI"

This sub‑decision should not block the rest of OPP‑028; it is a marketing call that can be made in parallel.

## Relationship to other opportunities


| Link                                                                                       | Why it matters                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [OPP-006: Email‑Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md)             | Provides `wiki/me.md`—the single most important input to the naming step. Naming is the **next chapter** of the same story this OPP told.                                                              |
| [OPP-018: First Chat After Wiki Draft](./OPP-018-first-chat-post-onboarding-prompt.md)     | The first chat **becomes the moment the assistant introduces itself by name**. The "wow" is no longer abstract; it is "Hi, I'm Corvin." Tighten OPP‑018 to assume the assistant has identity.          |
| [OPP-021: User Settings](./OPP-021-user-settings-page.md)                                  | New first‑class section: *About your assistant*. Rename, regenerate avatar, change personality preset, toggle daily variations.                                                                        |
| [OPP-042: Brain network epic](./OPP-042-brain-network-interbrain-trust-epic.md); [OPP-001: Agent‑to‑Agent](./OPP-001-agent-to-agent.md) | Cross‑user agent communication gains social texture. "Corvin reached out to Kalem about scheduling" reads as a relationship, not a protocol. The naming layer is what makes the federated story human. |
| [OPP-002: Public Brain Identity](./OPP-002-public-brain-identity.md)                       | Public‑facing identity benefits enormously from named, faced agents. "You're talking to Lewis Cirne's assistant Corvin" beats "you're talking to Lewis Cirne's brain."                                 |
| [OPP-014: Onboarding Folder Suggestions](./OPP-014-onboarding-local-folder-suggestions.md) | Same **agent‑specific presentation** generalization applies: naming and avatar steps want their own visual treatment, not raw chat chrome. Reuse the structured handoff pattern.                       |
| [Personal wiki (product)](../product/personal-wiki.md)                                     | Vocabulary needs a pass: "the assistant" becomes "your assistant" or the chosen name.                                                                                                                  |


## Implementation sketch (concrete)

### Server side

- `**wiki/assistant.md`**: Canonical assistant identity (name, sex, style one‑liner, rationale, avatar refs in frontmatter or body). Injected alongside `me.md` into the main agent system prompt.
- **Optional `${BRAIN_HOME}/assistant.json`**: Cache for avatar file paths, daily overlay cache, or WebView-only assets—must **rehydrate from** `assistant.md` if missing.
- **Profiling agent**: Extend onboarding profiling prompt so after `me.md` write it **must** call `suggest_assistant` repeatedly until quota or explicit completion tool. Reuse **same session context** (no second agent with cold start).
- **Tool definitions**: `suggest_assistant` with strict JSON schema `{ name, sex, style_one_liner, rationale }`; validate pronounceability / blocklist server-side on tool result.
- **Join API**: Either SSE events include `assistant_suggestion` + `assistant_suggestions_done`, or client polls `GET /api/onboarding/assistant/suggestions` keyed by profiling session until `complete`. Profile accept POST returns or sets `profileAccepted`; client computes `canShowAssistantPicker`.
- **Fallback naming endpoint**: `POST /api/onboarding/assistant/suggest-names` — only when tool path fails.
- **Avatar generation**: `POST /api/onboarding/assistant/generate-avatar` → image model → assets under `${BRAIN_HOME}/assistant/avatar/` + update `assistant.md` / JSON paths.
- **Daily overlay endpoint**: `GET /api/assistant/avatar/today` → overlay set + cache key.

### Client side

- **Profiling + review**: Do **not** navigate away from profiling SSE when `me.md` first appears; transition UI to review layout while **same stream** continues (or keep one session id through review).
- **State**: Track `profileAccepted` + `suggestionsReady` + list of tool results; gate **Continue** to naming-assistant.
- **New screens**: `naming-assistant` and `avatar-style` (or combined) in `src/client/lib/onboarding/`.
- **Identity store**: Load from `assistant.md` (and JSON if present) at boot. Top nav, chat, titles subscribe.
- **Avatar component**: Layered renderer for base + daily overlays.

### Desktop side

- Window title and macOS dock badge use the assistant name when available.

### Test surface

- Naming candidate generation should have a **golden test** with a synthetic `me.md` to detect quality regressions.
- Avatar layer composition has straightforward visual snapshot tests.
- Onboarding flow tests gain two new states.

## Risks and how we'll know if this is working

### Risks

1. **Race / stale suggestions.** User edits `me.md` heavily after the agent already emitted names grounded on an earlier draft. Mitigation: phase B runs on **post‑edit snapshot** if cheap, or re‑invoke suggestion tail on accept, or show a one‑line "names based on your draft profile" disclaimer if we accept staleness for v1.
2. **Generic outputs.** Five users get the same five names. Mitigation: **the rationale field is required** in the LLM contract; a name without a specific connection to `me.md` content is rejected and re‑prompted.
3. **Cultural insensitivity.** Name unintentionally awkward or offensive in another language; holiday overlays default to Western. Mitigation: cultural sensitivity pass on names; locale‑aware overlay rules; always allow opt‑out.
4. **Avatar quality variance.** One in twenty users gets an off‑model avatar. Mitigation: illustrated style + strong style anchor + regenerate affordance in settings.
5. **Personality is purely cosmetic.** User picks "warm" but the assistant behaves identically. Mitigation: ship the system‑prompt variants as part of the same change, not "later." Map `**style_one_liner`** → system‑prompt fragment.
6. **Renaming sprawl.** "Brain" leaks back into copy as new features ship. Mitigation: linter or PR check for user‑visible "Brain" outside the codebase / repo / build artifacts.
7. **Privacy reaction.** Some users feel "this app analyzed my email to pick a name for me" is invasive. Mitigation: framing in the UI is **transparent** ("based on what I learned from your mail"), the data was already analyzed for the profile step, and there is always a write‑in fallback.

### Success signals

- **Selection rate**: >60% of Tier 1 users pick an AI‑suggested name (not write‑in).
- **Retention proxy**: do users come back to the app the day after onboarding? The avatar variation hypothesis predicts a small but real lift here once the library has enough overlays to be noticeable.
- **Qualitative**: "felt personal" / "felt like it knew me" / "I love that Corvin wore a scarf today" in user interviews.
- **Negative**: "felt creepy" / "weird that the AI named itself" — both worth taking seriously, both worth distinguishing from "felt magical."

## Confidence

**8/10 this is shippable and differentiating.** The data input (`me.md`) is real. The technical pieces (LLM call, image generation, layered avatar composition) are all proven. The largest single risk is committing to an illustrated style that is composable from day one—if that art direction work is rushed or compromised, the daily‑variation magic collapses and we're left with just a rebrand.

The largest **product** risk is treating this as a cosmetic change. The name and the personality preset must be **wired to behavior**, or the moment of "meet your assistant" is the high point and everything after is a letdown. This OPP succeeds only if the assistant a user picked actually feels different from the one their friend picked—across many sessions, not just the first.

## Non‑goals

- Renaming the codebase, repo, env vars, or process names. "Brain" remains the internal codename indefinitely.
- Replacing the core agent runtime or chat/SSE architecture. **Do** add `**suggest_assistant`** (and related) tools and `**assistant.md**` injection—those are in scope; non‑goal is a wholesale new agent framework.
- Photorealistic avatars, voice synthesis, or animated avatars. Out of scope; the illustrated still avatar with daily contextual variation is the entire surface area.
- Multi‑avatar / multi‑persona switching within a single user. The user has **one** assistant. Renaming or regenerating is allowed in settings; runtime persona switching is not.
- Cross‑user avatar visibility or sharing. (Could become interesting under [OPP-042](./OPP-042-brain-network-interbrain-trust-epic.md) / [OPP-001](./OPP-001-agent-to-agent.md) / [OPP-002](./OPP-002-public-brain-identity.md), but not in scope here.)

