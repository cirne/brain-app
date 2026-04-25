# BUG-015: Onboarding profiling transcript — cramped vertical rhythm and misaligned tool hint

**Status:** Fixed (2026-04-24).

**Tags:** `onboarding`, `profiling`, `ui`

## Summary

On the **profile building** (profiling) transcript, the block under the lock + lead copy felt **vertically cramped**: the live status line (**blue pulse** + streaming markdown) sat too close to the intro paragraph. Below that, the **last-tool hint** row (e.g. envelope + **Search mail**) did not share a consistent **left column** with the pulse row.

## Fix

- **`OnboardingLocalWikiLead.svelte`:** Removed **`mb-4`** from the lead `<header>` so bottom spacing is not split between Tailwind and `.ob-prof-lead`.
- **`onboardingActivityTranscript.css`:** **`.ob-prof-lead`** uses **`margin: 0 0 1.25rem`** as the single source of space below the lead. **`.ob-prof-activity`** uses **`margin: 0.75rem 0 0.75rem`** for explicit top/bottom rhythm after the lead. **`.ob-prof-tool-hint`** uses **`padding-left: calc(6px + 0.5rem)`** so the hint lines up with the activity streaming text (same offset as 6px pulse + `0.5rem` gap).
- **Tests:** [onboardingActivityTranscript.test.ts](../../../src/client/lib/onboarding/onboardingActivityTranscript.test.ts) asserts the layout tokens in the CSS file (regression guard).

**Wiki seeding** uses the same lead component and shared transcript CSS; spacing remains consistent for title + lead there.

## Original report (history)

**Repro / surface**

- Hosted multitenant path: lead copy matches *“We're building your profile by learning from your emails…”* (`profilingLeadCopyMultiTenant` via `OnboardingLocalWikiLead` with `hideTitle`).

**Former diagnosis**

1. **Lead shell** — mixed **`mb-4`** on the header and **`.ob-prof-lead`** bottom margin.
2. **Activity row** — **`.ob-prof-activity`** had no `margin-top`.
3. **Tool hint** — no **`padding-left`** matching pulse + gap.

**Expected (achieved)**

- Clear **vertical spacing** between lead copy and the first status row.
- **Search mail** (and similar hints) **aligned** with the activity text column (same inset as pulse + gap).

**Code references (pre-fix; see current tree for final)**

- `OnboardingLocalWikiLead.svelte`, `onboardingActivityTranscript.css`, `OnboardingProfilingView.svelte` — as in repo after fix.
