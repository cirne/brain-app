---
name: copy
description: Rewrites and writes Braintunnel user-facing copy per docs/COPY_STYLE_GUIDE.md and obeys docs/architecture/i18n.md for web UI localization (namespaces, keys, locales path, $t usage). Prioritizes what the user needs—not product mechanics—with concise language aligned to the guide’s audience, jobs, jargon map, and deployment-neutral rules. Use when editing UI strings, i18n JSON, onboarding text, headings, hints, accessibility labels, agent-facing prompt phrasing (no-plumbing), or when the user asks for clearer/shorter copy or copy style.
---

# Copy (Braintunnel)

Follow both:

- **[`docs/COPY_STYLE_GUIDE.md`](../../../docs/COPY_STYLE_GUIDE.md)** — voice and tone; **Audience & posture**; **Jobs / non-goals**; **No-plumbing**; expanded **vocabulary** (vault/wiki, delegation, surfaces, notifications); desktop vs hosted; **SECURITY** alignment for claims; accessibility; checklist.
- **[`docs/architecture/i18n.md`](../../../docs/architecture/i18n.md)** — how Braintunnel ships UI strings (namespaces, key shape, locales location, `$t`, interpolation, what is in/out of scope). **Do not invent a parallel pattern**; obey that document when touching `src/client/**` localized copy.

When changing sizable copy or new surfaces, read both; this skill reinforces frequent fixes. **Strategy and roadmap** stay in **`STRATEGY.md`** / **`VISION.md`** — the style guide links there; pull vocabulary from the guide and English JSON, not from architecture filenames.

## The failure mode

**Bad copy explains how the product or UI works.** Good copy answers **what matters to the user right now** — next action, outcome, or reassurance — without walking them through internals or layout.

Characteristics to fix:

- **Mechanistic**: Describes tunnels, syncing, drafts “appearing,” where controls live, instead of task or outcome.
- **Verbose**: Repeated ideas across title, body, helper; filler (“so that,” long causal chains).
- **Technical**: Code-adjacent terms (agent/tool/slug/route IDs), plumbing, deployment details the user shouldn’t narrate — use the guide’s jargon table (**brain query** → permission / approve-before-send wording, etc.).
- **Audience-blind**: Ignores **smart, busy non-developers** — see guide **Audience & posture**.

## Rewrite lens (use every time)

1. **Audience**: Would they say this sentence aloud? Would they care? Match **Audience & posture** in the guide.
2. **Job**: Label or sentence should match **intent** — recover, approve, retry, acknowledge — not system flow (**Jobs we support** in the guide).
3. **Length**: Default short. Helpers and subtitles are single ideas. Cut “where it appears” and “when X happens.”
4. **No-plumbing**: No implementation path. Do not narrate where options “appear” unless omission would confuse. State what they can do or what happened, in ordinary language.
5. **Surfaces**: Use **assistant** / **chat**, **Hub**, **Inbox** (mail UX), **vault** vs **wiki** as in the guide — not internal module speak.

## Translate product mechanics → user need

| Avoid (explains mechanics / UI plumbing) | Prefer (need or action) |
| ---------------------------------------- | ------------------------ |
| Explaining tunnels, syncing, drafts “here,” “what goes back” step-by-step | Outcome + control without the tour |

**Concrete bad line (too much product narration):**

> When someone reaches you through a tunnel, drafts and send options appear here so you control what goes back across the tunnel

**Direction (do not lengthen):** Strip tunnel mechanics and placement. Speak to **approve / send what you want**, or **you decide the reply**. Match the actual control (one short phrase or headline + optional 4–10 word helper — not a paragraph).

Prefer patterns from **[`COPY_STYLE_GUIDE.md`](../../../docs/COPY_STYLE_GUIDE.md)**: No-Plumbing tables, delegation row (**approve before sending** / permissions), vocabulary (vault vs wiki, notes/pages, Braintunnel name, notifications vs inbox), and hosting-accurate shared copy.

## Verification (before shipping strings)

Ask:

1. **Does this sentence exist mainly to educate me about internals?** If yes, delete or replace with outcome/action.
2. **Can I halve the word count** without losing the only actionable idea?
3. **Would a developer-only term slip through?** Use the guide’s jargon table — no raw architecture identifiers in UI.
4. **Desktop vs hosted**: Post-onboarding, is wording true for both unless behavior truly differs? (Examples in the guide.)
5. **Trust claims**: Anything about encryption/staff/access must match **`SECURITY.md`** / deployment truth.
6. **Accessible names**: `aria-*`, `title`, placeholders — same vocabulary bar as visible text.

## i18n (`src/client/**`)

Operational rules are in **`docs/architecture/i18n.md`**. Apply at minimum:

- English source strings live under **`src/client/lib/i18n/locales/en/*.json`** (`common`, `nav`, `chat`, `hub`, `inbox`, `wiki`, **`access`**, etc.); keys use **`$t('namespace.dotted.key')`** and **stable dot-paths by domain**.
- Localize visible text plus **placeholders**, **`title`**, and **`aria-*`** where applicable; keep behavior unchanged when extracting from components.
- Use **interpolation** for dynamic fragments per that doc — not string concatenation in the UI layer.
- New strings: choose namespace → add JSON → replace hardcoded text with `$t` → run **lint/typecheck/tests** per the doc’s checklist. **Reuse** existing product terms across namespaces before introducing synonyms — see guide **i18n and shipped English**.

**Agent prompts** (`src/server/prompts/**`): Same no-plumbing bar; localization is intentionally separate — see **`i18n.md`** scope.

Same copy-quality bar as prose: shorten **values** toward user-needed phrasing; **keep keys stable** unless you are deliberately renaming keys with coordinated call-site updates.
