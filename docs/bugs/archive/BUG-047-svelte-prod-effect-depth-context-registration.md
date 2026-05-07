# BUG-047: Svelte 5 `effect_update_depth_exceeded` — slide header registration & parent callbacks (prod-heavy)

**Status:** Fixed / closed (2026-05-07)

## Historical summary

Production-primary loops from **fresh slide-header payload literals** (inline handlers) bumping `updateSeq`, plus **`$effect`** paths that subscribed to **unstable parent callbacks** (`onContextChange`, hear-replies toggles, etc.). Symptoms matched [`effect_update_depth_exceeded`](https://svelte.dev/e/effect_update_depth_exceeded) / minified `infinite_loop_guard`, often only after `npm run build` preview.

## Fix / closure

- **Stable registrations:** semantic **`equals`** on wiki slide headers (`wikiSlideHeaderPayloadEquals`), memoized payloads, stable handler identities (`Inbox`, `WikiDirList`, `Wiki`, calendar/email hubs, etc.).
- **`untrack`** where effects must invoke parent callbacks without subscribing to changing function refs (`WikiDirList` wiki-dir publish pattern; hear-replies propagation).
- **Instrumentation:** temporary `$effect` console tagging used during diagnosis **removed** from shipped client sources.

Residual risk follows normal guidelines below when adding new **`register*Header`** or **`onContextChange`** effects.

---

## Reference: failing patterns (anti-patterns)

### 1. Registering a **new object literal** on every effect / derived run

Child does:

```ts
$effect(() => {
  registerX?.({
    onFoo: () => { ... }, // new function identity every time
    ...
  })
})
```

or `$derived.by(() => ({ ... inline arrows ... }))` such that **any** spurious re-run or recomputation produces **new function references**.

**Why it blows up**

- `createSlideHeaderRegistration` in `SlideOver` updates internal `$state` and **`updateSeq`** when the registered value is not `Object.is`-equal to the previous one.
- **New object** with **new inline callbacks** → never `Object.is` → **always** `updateSeq++` → parent / shell re-renders → child effects re-enter → **`effect_update_depth_exceeded`**.

**Mitigations**

- **Stable handlers:** named `function` / methods on the component instance so identities stay stable across runs when semantics don’t change.
- **Memoized payload:** put the object in `$derived.by` that **only** recomputes when real inputs change; keep handler refs stable (see `Inbox.svelte` thread toolbar pattern).
- **Semantic equality:** `createSlideHeaderRegistration(key, { equals })` — for wiki headers, `wikiSlideHeaderPayloadEquals` in `wikiSlideHeaderContext.ts` compares scalar fields **and** `setPageMode` / `onOpenShare` / `flushSavingMarkdown` **reference identity** so duplicate literals with the same handlers do not bump `updateSeq`.

**Code**

- `src/client/lib/slideHeaderContextRegistration.svelte.ts` — optional `equals`.
- `src/client/lib/wikiSlideHeaderContext.ts` — `wikiSlideHeaderPayloadEquals`.
- `src/client/components/shell/SlideOver.svelte` — wiki hdr uses `{ equals: wikiSlideHeaderPayloadEquals }`.
- `src/client/components/WikiDirList.svelte`, `Wiki.svelte` — stable slide header handlers.

---

### 2. `$effect` that calls **`onContextChange` / parent props** and also **tracks unstable callback identity**

```ts
$effect(() => {
  onContextChange?.({ type: 'wiki-dir', ... })
  return () => onContextChange?.({ type: 'none' })
})
```

If `onContextChange` is a **new function reference** every parent render (e.g. inline arrow in parent), the effect **re-runs continuously**. Cleanup + body can **ping-pong** shell state (`none` → `wiki-dir` → …) and amplify flushes.

**Mitigations**

- Read only **stable reactive inputs** in the effect (e.g. `dirPath`).
- Invoke the parent callback inside **`untrack(() => onContextChange?.(...))`** so the effect does **not** subscribe to the callback prop.
- Emit **`{ type: 'none' }` from `onDestroy`**, not from `$effect` cleanup on every dependency change.

**Code:** `src/client/components/WikiDirList.svelte` (wiki-dir context publish).

---

### 3. **`$effect` propagating to parent with unstable props**

Example: `AgentChat.svelte` calling `onHearRepliesChange?.(value)` while also **subscribing** to `onHearRepliesChange` identity. Parent passes `onHearRepliesChange={(x) => ...}` → new ref every render → effect re-runs.

**Mitigation:** read the reactive value in tracked scope, call the callback inside **`untrack`**.

---

## Reference: why production was worse

- Stricter / different effect scheduling and batching vs dev HMR.
- Minified stacks obscure source; diagnosis used short-lived tagged `$effect` logs (removed from sources when closing this ticket).

---

## Ongoing hygiene (new header / context effects)

When adding **`register*Header`**, **`getContext` + `$effect`**, or **`onContextChange`** publishers:

- Avoid **new object literals** with **inline** `() =>` handlers every run for registered payloads.
- Prefer **`untrack`** for parent prop invocation when the callback identity must not be a dependency.
- Consider **`equals`** on registration where semantic equality beats reference equality.

---

## Related errors

- Svelte: [`effect_update_depth_exceeded`](https://svelte.dev/e/effect_update_depth_exceeded)

---

## Tests

- `src/client/lib/wikiSlideHeaderContext.test.ts` — `wikiSlideHeaderPayloadEquals`.
- Component tests that mount `SlideOver` / `Wiki` / `WikiDirList` with header context.
