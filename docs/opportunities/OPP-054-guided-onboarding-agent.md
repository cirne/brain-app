# OPP-054: Guided Onboarding Agent (Replaces First Chat)

**Status:** Active  
**Related:** [OPP-006 (archived)](../opportunities/archive/OPP-006-email-bootstrap-onboarding.md), [OPP-018 (archived)](../opportunities/archive/OPP-018-first-chat-post-onboarding.md), [OPP-028](OPP-028-named-assistant-identity-and-living-avatar.md), [ripmail OPP-047](../../ripmail/docs/opportunities/OPP-047-adaptive-rules-learning-agent.md)

---

## One-line summary

Replace the first-chat drop into the main agent with a **structured onboarding conversation** that starts as soon as a **minimal indexed corpus** exists (on the order of ~200 messages). **Do not author `wiki/me.md` beforehand.** The interview opens by confirming the user’s identity and a short bio guess, then walks calendar defaults, inbox rules, and **who counts as an important person** (using existing contact tools). Wiki seeding runs in the background the whole time. When the interview completes, the system **writes `me.md` for the first time** from everything learned and triggers a **wiki refresh/rebuild** so pages align with the settings and people the user confirmed.

---

## The problem with the current approach

The profiling agent (OPP-006 lineage) historically tried to do too much too soon — including writing **profile artifacts** — while the inbox is still young. Contacts and priorities get distorted; mining “key people” from a thin index mislabels relationships, and shipping an early **`me.md`** anchors bad facts.

The first chat (OPP-018) currently drops the user into the main agent immediately after seeding, with no structured bridge. The onboarding ends, chat begins, and the user has to discover on their own what to ask for.

Both problems stem from the same root: the handoff happens before the system has enough signal, and before the user understands what the product can do.

---

## Core insight: time is the asset

Email indexing and wiki seeding take several minutes. Early on, the inbox is intentionally **not** the source for a brittle `me.md`.

Once **enough messages are indexed for a sane first-pass guess** (~200 messages as a workable threshold — tune in implementation), the user should **leave progress UI and enter the onboarding interview**. The wiki seeding agent can already have been running; it does **not** need its own blocking “building your wiki” phase in the chat flow. Later, **after** calendar rules, inbox rules, and important-people confirmations exist, **rebuild or refresh** the wiki so structure and stubs match reality.

Each interview phase stays short — the onboarding conversation **uses overlapping time productively**, and exits with sufficient signal for a first **`me.md` author**, not a skeletal file written too early.

---

## Trigger: no `me.md` until after the interview

**Do not write `wiki/me.md` during initial profiling.** The profiling path should not pretend to lock in identity beyond what is safe to keep **in-memory** or in the onboarding prompt preamble (infer name, organizational one-liner, OAuth / `ripmail whoami` — same sources the app already uses server-side).

**Start the onboarding agent** once indexing has crossed a **minimal corpus gate** (~200 messages — adjust with telemetry). Until then the user stays in indexing/progress UX; once the gate clears, move straight into Phase 1. There is no separate “please wait while we build your wiki first” blocking step in chat — wiki building proceeds **in parallel** with indexing and continues during the interview.

After the interview, **`me.md` is authored once** from confirmed answers + matured index signals + existing wiki stubs (see below).

---

## The guided onboarding agent

This agent runs once the **`onboarding-agent`** state is entered **after** the corpus threshold is met — see state machine below. Wiki **seeding continues in parallel** throughout; indexing also continues afterward. This flow **replaces** the first chat entirely and immediately precedes the user’s first open-ended session with the main agent.

It is a **structured interview** (five phases plus a silent finalize step), delivered as a flowing conversation with suggested actions — quick-select chips where appropriate, always with free-text correction. Each phase stays short.

The agent works **within the existing chat infrastructure** (SSE streaming, tool calls rendered as activity). No new UI primitives beyond suggested-action chips. Each phase follows: the agent proposes, the user adjusts or confirms, both move on.

### Phase 1: Confirm identity (name and bio guess)

**Goal:** Validate who the user is before anything else touches `me.md`. This is **the first conversational turn** — not silent profiling.

**What happens:**

Open with **one compact paragraph**: your best guesses from OAuth / `whoami`, signatures, early sent-mail patterns — legal name vs how they introduce themselves (“Lou,” “Louis”), and a single line about what they do. Ask them to correct anything (**“Do I have your name right? Do you go by Lou?”**-style). This is deliberately low ceremony: a short acknowledgment of uncertainty is fine (“here’s what I inferred so far”).

Prefer **chips where they help** (“Yes / That’s wrong — I’ll type it”) plus free-form edit. Capture corrections for the eventual `me.md`.

**Agent instructions:**
> Offer a tight summary of guesses: name/preferred address form, organization or role line. Invite correction in plain language — no bullet-wall checklist. Confirm or fix, then proceed.

---

### Phase 2: Name the assistant

**Goal:** Give the assistant a name the user chose. Establish the relationship as personal once their own identity is confirmed (OPP-028).

**What happens:**

The agent explains it is their personal assistant and would like a name. It queries `wiki/assistant.md` if it exists, otherwise proposes options.

It suggests **five names** as quick-select chips grounded in Phase 1 (professional domain cues if present; otherwise distinctive, warm general-purpose names). Each chip shows the name with a **one-word personality note** (e.g. *"Vela — calm"*, *"Kalem — direct"*). Free-text naming always remains available.

Once a name is selected:

- The agent calls `write_wiki_file("assistant.md", …)` with the chosen name and a short note.
- The conversation uses that name going forward.
- Top nav / chat chrome can update via the same identity plumbing as OPP-028.

**Agent instructions:**

> Offer five suggested names with one-word personality notes; allow typing any name. After selection, acknowledge briefly and continue.

---

### Phase 3: Calendar setup

**Goal:** Identify which calendars to hide from the assistant's default context, so responses about "what's on my schedule" are not cluttered with shared or delegated calendars the user doesn't own.

**What happens:**

The agent calls `list_calendars()` and examines the result. In most professional setups there is one primary calendar and then a collection of others: team calendars, shared family calendars, "Holidays in US," read-only subscriber feeds, etc.

The agent presents the calendar list and **recommends** which to hide, presented as a pre-selected chip list the user can deselect. The heuristic:

- **Keep visible by default:** calendars where the user is the organizer of most events (their primary calendar).
- **Suggest hiding:** calendars with names like "Holidays," "US Holidays," shared team calendars with many attendees per event (probably org-wide), and calendars clearly owned by someone else.
- **Ask about ambiguous ones:** calendars with names that could be personal or shared.

The user can approve the suggestion in one tap, or adjust by deselecting chips.

On confirmation, the agent calls `hide_calendars([...ids])` (or the equivalent settings write). It confirms briefly: *"Got it — I'll use just your main calendar by default. You can always ask me to check the others specifically."*

**Agent instructions:**

> Fetch calendars. Prefer the user's primary calendar. Pre-select hides for noise calendars. Explain briefly that hidden calendars are not deleted — one tap approve when possible.

---

### Phase 4: Inbox rules

**Goal:** Set up a small number of inbox rules that surface what's important and suppress what isn't, so the assistant's email tools return high-signal results.

**What happens:**

The agent does a quick pass over the inbox — common senders, domains, subject patterns — and proposes **three to five rules** (existing ripmail `rules.json` surface).

Example rules:

- *"Mark everything from \*.newsletter.com as low-priority"*
- *"Always surface emails from your top contacts"*
- *"Flag emails with 'urgent' or 'action required' in the subject"*
- *"Suppress calendar notification emails (already in calendar)"*

Present as chips, pre-approved, one-line rationale each; user can deselect; confirm once.

On confirmation the agent writes the rules. This phase doubles as proof the assistant operates on inbox, not chat-only.

**Agent instructions:**

> Propose 3–5 decisive rules from obvious noise patterns. Pre-approved chips; concise confirmation after approval.

---

### Phase 5: Important people

**Goal:** Sanity-check **who belongs in inner circle vs noise** — the sort of judgments that shouldn’t ship from index-only guesses without a thumbs-up.

**What happens:**

Use existing tooling: **`ripmail who`**-backed contact frequency via the agent’s **`find_person`** tool (empty `query` yields top contacts, same semantics as CLI `who --limit 60`), plus **`ripmail whoami`** / OAuth identity already in context — don’t reinvent identity.

Propose a **short list of people** as “probably important”; present as selectable chips (**include / exclude / skipped**). Invite one-line fixes (“that’s my accountant, not a friend”).

Tone: **lightly** acknowledge incompleteness without a lecture — e.g. you don’t have the full mailbox yet so you **may miss** future important threads, and **heavy recent traffic isn’t automatically deep relationship**. Avoid over-explaining; one short clause is plenty.

Confirmations inform `me.md` (relationship cues) and can tag or prioritize wiki/contact stubs in the downstream rebuild step.

**Agent instructions:**
> Infer from top contacts plus obvious patterns. Surface a compact list — not everyone they’ve ever mailed. Invite corrections. Stay humble about corpus limits in one sentence if needed.

---

## After the interview: author `me.md` and refresh the wiki

There is **no pre-existing `wiki/me.md`** to update. When the user completes the five phases (or skips some), the onboarding flow runs a **silent finalize** before handoff to open chat:

1. **Author `wiki/me.md` once** — synthesize from the interview (identity, assistant name, calendars, rules, important-people confirmations), the current mail index, OAuth / `whoami`, and whatever wiki pages the seeding agent has already created (people/projects/areas stubs).

2. Set frontmatter **`confidence: full`** (or the project’s equivalent) so the main agent treats the profile as onboarding-complete.

3. **Wiki refresh / rebuild** — re-run or reschedule the wiki buildout/seeding pass so structure and contact-related pages **respect** hidden calendars, inbox rules, and the user’s **important-people** judgments. Exact mechanism (full rebuild vs incremental refresh) is implementation detail; the requirement is **alignment after settings + people are known**, not midway through a blocking “wiki phase” in chat.

The user does not need a lengthy review UI. A single optional chip (“Open your profile in the wiki”) can close the loop.

**Design payoff:** `me.md` is **not** authored from a half-baked index before the interview; it appears when there is enough signal **and** explicit user confirmation on the questions that matter.

---

## Handoff to main chat

After finalize, the agent transitions in one natural line — e.g. that you’re set up, the wiki will catch up with what you confirmed, indexing continues, and you’re free to ask anything.

There is no modal or separate “chat mode.” The main agent loads with **`me.md` and `assistant.md`** in place. **Seeding and indexing can keep running** after handoff.

The onboarding thread is **preserved** so the user can scroll back to what was configured.

---

## Onboarding state machine changes

The existing OPP-006 state machine:

```
idle → indexing → profiling → reviewing-profile → confirming-categories → seeding → done
```

Proposed new state machine:

```
idle → indexing → (corpus gate ~200 msgs) → onboarding-agent → finalize (me.md + wiki refresh) → done
```

Concurrent: **seeding** runs in the **background** from early indexing onward (and continues after handoff), not as a chat-blocking “build your wiki first” gate.

Key changes:

- **No `me.md` write** during profiling — the interview supplies the first user-validated profile pass toward `me.md`.
- **`reviewing-profile` / `confirming-categories`** — remove or collapse into server-side defaults so they don't block entering onboarding.
- **`onboarding-agent`** — five-phase interview, entered when the **indexed corpus threshold** (~200 messages, tune with telemetry) is met — not contingent on wiki completion.
- **`finalize`** — author `wiki/me.md` for the **first time** and **trigger or schedule** a **wiki refresh or rebuild** so pages align with calendar, inbox rules, and confirmed important people.

The seeding agent’s upfront “approve categories?” prompts should stay **non-blocking** (toast/status). Deep wiki research prompts belong in **main chat**, not here.

---

## System prompt for the onboarding agent

The onboarding agent has a distinct system prompt from the main agent. Key elements:

```
You are [assistant name, or "the assistant" if not yet named], running a structured onboarding 
for a new Braintunnel user. Your job is to:

1. Make this feel like a warm, personal conversation — not a setup wizard.
2. Move through five phases in order: confirm user identity (name / how they go by / short bio 
   guess — correct anything wrong), name the assistant, calendars, inbox rules, important people.
3. Use find_person when helpful (empty query = top contacts via ripmail who); combine with 
   whoami / OAuth facts already injected — do not guess important people silently for me.md alone.
4. Use short, direct sentences. No bullet walls. No over-explaining.
5. Keep the full interview under ~10 minutes — useful, not exhaustive.
6. At finalize (silent to the user — not a questionnaire), synthesize wiki/me.md from interview 
   answers plus index + stubs; downstream job refreshes the wiki — that is outside this chat transcript.

Tools available: list_calendars, hide_calendars, ripmail_search, ripmail_inbox, 
write_wiki_file, read_wiki_file, write_inbox_rules, find_person.

Context: wiki/me.md does not exist yet until finalize; wiki/assistant.md after naming phase; 
current wiki page list when available.
```

The agent must not revert to open-ended chat mode mid-interview. If the user asks an off-topic question (e.g. "can you search my email for X?"), the agent answers briefly and brings the conversation back to the current phase.

---

## Suggested-action chips

Chip where they reduce taps; preserve free text wherever the user needs to fix a guess (especially identity):

- **Identity:** confirmation vs “incorrect — I'll correct” (+ free text).
- **Assistant name:** five suggested names (+ free-text name).
- **Calendar:** calendars suggested for hiding; tap to toggle.
- **Inbox rules:** one chip per suggested rule; confirm.
- **Important people:** per-person include/exclude or similar — keep lists **short**.

The agent proposes; the user adjusts. Skipping a phase stays valid.

---

## Why this is better than the current flow

| Dimension | Current | New |
|---|---|---|
| Profile accuracy | Often wrong when written too soon | Threshold + confirm identity before `me.md` |
| User training | Dropped into open chat | Guided: identity → assistant → calendars → mail → people |
| `me.md` | Risk of brittle early author | First write at finalize from answers + richer index |
| Assistant identity | Generic | Named after Phase 1 grounds who they are |
| Calendar / inbox | Default noise | Explicit defaults confirmed in-chat |
| Key people | Inferred silently | Named list with user judgment + `find_person` / who |
| Wiki | Blocking tour / early promises | Builds in parallel; refresh after finalize |

---

## Risks

1. **Interview length.** Five phases plus finalize could drag if verbose. Mitigation: enforce short turns in the onboarding system prompt.
2. **Calendar API.** Same as today — degrade gracefully when tools fail.
3. **Inbox rules.** Mitigation — conservative suggestion sets; explicit approval required.
4. **Important people.** False positives (“you email them a lot so they matter”) bruise trust. Mitigation — short proposals, trivial to reject; light humility about corpus limits (one clause, no essay).
5. **Corpus gate too low or high.** ~200 messages is heuristic; telemetry should tune gate vs time-to-first-interview.
6. **User skips broadly.** Allowed — finalize still produces something from light signals but should not hallucinate richness.
7. **Assistant naming vs OPP-028.** If OPP-028 lands first, share the naming UI and file write paths.

---

## Non-goals

- Replacing mail source selection and indexing (OPP-006-era concerns stay upstream).
- A full-account settings replica — onboarding sets a coherent baseline only.
- A dedicated **blocking** “building your wiki” chat phase — wiki churn runs in parallel; onboarding does not wait for it mid-flow.
- A **wiki inventory tour** or mandatory **deep research picker** mid-onboarding — that belongs in steady-state chat once the wiki has caught up post-refresh.

---

## Confidence

**High** on primitives (calendar, rules, wiki writes, **`find_person`**, streaming chat chips). Concrete build work:

1. Stop authoring `wiki/me.md` from profiling — gate on corpus size and run the five-phase onboarding agent instead.
2. Onboarding prompts + deterministic phase scaffolding (ordering, finalize hook).
3. **Finalize:** first `me.md` synthesis + wired **wiki refresh/rebuild** after calendar, rules, and people are known.
4. State machine wiring and telemetry for the corpus threshold.

The expected outcome remains: onboarding leaves the user knowing what was configured **and** a profile plus wiki stance that match what they affirmed.
