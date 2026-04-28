# BUG-014: Per-stage setup URLs, deep-link guards, OAuth return target, and user-visible naming (not "onboarding")

**Status:** Open

**Summary**

First-time **setup** (internal: onboarding) should have a **dedicated URL for each stage** so users can bookmark, share support links, and return cleanly after external flows. Direct navigation to a **stage the user is not ready for** should **redirect to the latest valid stage** for their current server state, not a blank or wrong screen. The **Google OAuth browser callback** (after hosted Gmail connect) should **land on the correct setup stage URL**, not a single generic path.

Separately, **"onboarding"** is **internal / team language**. User-visible copy, browser tab titles, and **path segments** should use product-appropriate strings (e.g. **Get started**, **Set up your Brain**, **Welcome**—exact choice TBD) while code and APIs may keep `onboarding` where migration cost is high.

**Symptom / today**

- The hosted OAuth success HTML redirects to a single path, e.g. `/onboarding` (see embedded HTML in `src/server/routes/oauthGoogleBrowserPages.ts`—refresh, `location.replace`, and “Redirecting to onboarding…” copy).

```13:35:src/server/routes/oauthGoogleBrowserPages.ts
const completeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  ...
  <meta http-equiv="refresh" content="3;url=/onboarding" />
  ...
    setTimeout(function () { window.location.replace('/onboarding'); }, 600);
  ...
  <p>Redirecting to onboarding… If nothing happens, <a href="/onboarding">continue here</a>.</p>
```

(Citation is abbreviated with `...` for the bug doc; see source file for the full template.)

- The client **setup** experience is largely driven by **in-memory / API state** on one route, not a stable per-stage path for every state (vault, mail, profiling, profile review, etc.).

- Users and support may see the word **"onboarding"** in the UI and URLs, which reads as product/engineering jargon.

**Expected**

1. **Route map**  
   - Each **public setup stage** has a **canonical path** (and optionally a short internal alias during migration with 301/redirect from old paths).  
   - Stages should align with **onboarding state machine** (see `onboardingState` / client `Onboarding.svelte` flow), including edge cases (e.g. mail indexing vs state race called out in code comments).

2. **Guards**  
   - If the user **opens a URL for a later stage** than their saved progress allows, the app **redirects** to the **furthest allowed stage** (or a single "resume" path that then redirects once—either is fine as long as behavior is consistent).  
   - If they open an **earlier** stage, product decision: allow (retry) vs redirect forward—**document the rule**; default suggestion is **allow backward navigation** for recovery unless a stage is strictly one-time.

3. **OAuth**  
   - After Google redirects to the app’s OAuth **browser** success/failure page, the next navigation should be **`replace()` (or 302) to the setup stage URL** that matches “mail connected, continue from here” (or failure stage), not always the same string.

4. **Naming**  
   - **User-visible:** replace "onboarding" in **labels, titles, and URL paths** with agreed product copy (single glossary entry in this bug or a one-line `docs/architecture/…` note when implemented).  
   - **Code:** optional phased rename; **minimum** is **routes and UI** users see. API path `/api/onboarding/...` can stay or get a versioned alias—call out in implementation notes.

**Non-goals (unless bundled)**

- Full rename of every internal symbol and folder from `onboarding` in one pull—prefer **shippable slices**: URLs + guards + OAuth first; copy + path segment rename next.

**Tags:** hosted, first-run, deep-link, OAuth, UX

**Related**

- OPP-058 ([runtime-and-routes.md](architecture/runtime-and-routes.md)): chat **`/c` / `/c/:sessionId`**, hub **`/hub`**, overlays **`?panel=`** — OAuth **callback** paths stay `/api/oauth/...`.
- OPP-042 and other first-run / network docs if they mention onboarding URLs—update when this ships.  
- BUG-010 (post-setup first-chat kickoff) may interact with "resume" and deep links; coordinate tests.
