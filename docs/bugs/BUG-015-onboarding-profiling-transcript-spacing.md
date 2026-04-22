# BUG-015: Onboarding profiling transcript — cramped vertical rhythm and misaligned tool hint

**Status:** Open

**Summary**

On the **profile building** (profiling) transcript, the block under the lock + lead copy feels **vertically cramped**: the live status line (**blue pulse** + streaming markdown) sits too close to the intro paragraph. Below that, the **last-tool hint** row (e.g. envelope + **Search mail**) does not share a consistent **left column** with the pulse row, so the hint reads **indented relative to the bullet** (or inconsistent with the status text column).

**Repro / surface**

- Hosted multitenant path: lead copy matches *“We're building your profile by learning from your emails…”* (`profilingLeadCopyMultiTenant` via `OnboardingLocalWikiLead` with `hideTitle`).
- Screenshot (local): `/Users/cirne/.cursor/projects/Users-cirne-dev-brain-app/assets/Braintunnel_2026-04-22_at_5.15.29_PM-83571fb1-5877-4a5b-bbcb-e23534527c46.png`

**Likely CSS hierarchy (for fix)**

1. **Lead shell** — `OnboardingLocalWikiLead.svelte`  
   - Outer `<header class="mb-4 flex …">` (Tailwind spacing).  
   - Inner `<p class="ob-prof-lead">` also uses **`.ob-prof-lead { margin: 0 0 1rem; }`** in `onboardingActivityTranscript.css`.  
   - Spacing below the lead is split across **two mechanisms**; verify **margin collapse** / effective gap between `</header>` and the next sibling, especially when the title is hidden (only the lead remains).

2. **Activity row** — `OnboardingProfilingView.svelte` + `onboardingActivityTranscript.css`  
   - **`.ob-prof-activity`** sets **`margin: 0 0 0.75rem`** (no `margin-top`), so vertical separation from the lead depends entirely on the header/lead margins above. If those collapse or are overridden by an enclosing utility, the status line will sit **flush** against the intro.

3. **Tool hint** — same CSS file, **`.ob-prof-tool-hint`**  
   - Flex row with icon + label; **no shared grid / `padding-left`** with **`.ob-prof-activity`** (pulse `6px` + `gap: 0.5rem` vs hint’s own icon size and `gap`). Align hint with either the **pulse column** or the **markdown column** deliberately (one wrapper + CSS grid, or matching `padding-left` / `margin-left`).

4. **Enclosing scroll** — `OnboardingActivityTranscriptShell.svelte` uses **`chat-transcript-scroll`** (`style.css`: padding via `--chat-transcript-pt` / `--chat-transcript-px`). That should not zero block margins; confirm no parent **`gap: 0`** + negative margin or **`overflow`** clipping that visually tightens the gap.

**Expected**

- Clear, consistent **vertical spacing** between lead copy and the first status row (match other onboarding panes / chat transcript rhythm).
- **Search mail** (and similar hints) **visually aligned** with the activity row’s bullet + text columns (or a documented single left edge), without looking like a stray indented line.

**Fix direction**

- Consolidate lead spacing: prefer **one** source of bottom spacing (either header margin or `.ob-prof-lead` margin, not both fighting collapse), and give **`.ob-prof-activity` an explicit `margin-top`** if the design token calls for it.
- Optional: wrap pulse + activity markdown + tool hint in a **single column layout** (e.g. grid: `[pulse] [stack]`) so alignment is structural, not eyeballed per class.

**Code references**

```8:24:src/client/lib/onboarding/OnboardingLocalWikiLead.svelte
<header
  class="mb-4 flex items-start gap-3 [font:inherit]"
  aria-labelledby={hideTitle ? undefined : "ob-local-wiki-title"}
>
  ...
    <p class="ob-prof-lead">{lead}</p>
```

```50:105:src/client/lib/onboarding/onboardingActivityTranscript.css
.ob-prof-lead {
  margin: 0 0 1rem;
  ...
}

.ob-prof-activity {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  ...
  margin: 0 0 0.75rem;
  ...
}

.ob-prof-tool-hint {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 1.25rem;
  ...
}
```

```80:101:src/client/lib/onboarding/OnboardingProfilingView.svelte
    <OnboardingLocalWikiLead {...profilingLead} hideTitle />

    {#if streaming && activity}
      <div class="ob-prof-activity" role="status" aria-live="polite">
        ...
      </div>
    ...
    {#if streaming && lastTool && lastToolIcon}
      ...
      <p class="ob-prof-tool-hint">
```
