# BUG-029: First-run setup — `/welcome` URL, vault-root `assistant.md`, calendar listing

**Status:** Open (fix in progress / verify after ship)

**Summary**

First-time guided setup had several rough edges: browser landed on OAuth intermediate paths and `/onboarding` with user-visible “onboarding” wording; agent wiki policy blocked `**assistant.md`** at vault root so writes fell back to paths like `**onboarding/assistant.md**`; the calendar phase sometimes summarized as “only primary” instead of enumerating calendars from `**list_calendars**`.

**Expected**

1. **URL / copy:** Canonical SPA path for the first-run guided interview is `**/welcome`**. OAuth success/failure HTML redirects there with neutral copy (no “Redirecting to onboarding…”). Broader per-stage deep links remain tracked under **BUG-014**.
2. `**assistant.md`:** File lives at **wiki vault root** next to `**me.md`**. Phase 2 of the guided interview continues to write it so setup can be verified manually.
3. **Calendar:** After `**list_calendars`**, the assistant enumerates **each** calendar from tool output (name/id) before `**configure_source`**, unless the tool truly returns a single row or an empty list (empty → acknowledge and tie to **BUG-027** if scopes/sync).

**Primary files**

- `src/client/router.ts`, `src/client/App.svelte`
- `src/server/routes/oauthGoogleBrowserPages.ts`
- `src/server/lib/wiki/wikiAgentWritePolicy.ts`
- `src/server/prompts/onboarding-agent/system.hbs`

**Related:** [BUG-014](BUG-014-setup-flow-per-stage-urls-and-naming.md), [BUG-027](BUG-027-calendar-create-event-empty-list-rejects-source.md)

**Tags:** hosted, first-run, OAuth, wiki, calendar