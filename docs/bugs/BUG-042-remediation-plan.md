# BUG-042 remediation plan: unified wiki search (include shared) + provenance

**Bug:** [BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md](./BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md)  
**Decision:** Keep **default search scope = full `wikis/` tree** (`me/` + `@handle/` projections). Do **not** hide shared hits by default; fix trust via **explicit provenance in tool output** and **prompt discipline**.

---

## Goals

1. Every `**find` / `grep`** hit (and `**read`**, when useful) makes **personal vs shared** obvious without the model inferring path grammar.
2. When a result set **mixes** `me/` and `@*/`, the model sees a **short batch summary** (counts + handles).
3. `**assistant/base.hbs`** states an **attribution rule**: quoting or summarizing from `@handle/…` requires naming the collaborator / shared source; “my …” questions must not be answered as if shared content were the user’s unless  `me/` also agrees.
4. Align vocabulary with **unified paths** (`me/…`, `@handle/…`) and `open` / overlay behavior (see [BUG-040](./BUG-040-wiki-chat-overlay-shared-doc-open-fails.md)).

## Non-goals (initial ship)

- Changing default scope to **me-only** (optional **narrowing param** can be a follow-up).
- Migrating or backfilling historical tool traces.
- Teaching ripmail `**search_index`** about wiki provenance (this bug is wiki `**find`/`grep`/`read`**; keep planes separate per `assistant/base.hbs`).

---

## Implementation phases

### Phase 1 — Pure classification + formatting (backend)

1. **Add a small helper** (suggested: `src/server/lib/wiki/wikiToolProvenance.ts`, tested in `*.test.ts`):
  - Input: path **relative to `wikis/` tool root** (as returned by find/grep today), POSIX-normalized.
  - Output: `{ scope: 'me' | 'shared'; handle: string | null }` where `shared` means first segment starts with `@` and `handle` is the segment **without** `@`; `me` means under `me/` (including `me.md` at vault root if applicable — match existing `WIKIS_ME_SEGMENT` / `vaultRelPathFromMeToolPath` semantics).
2. `**find` tool** (`src/server/agent/tools/wikiScopedFsTools.ts`): After the inner find returns, post-process the **text listing** (and `details` if present):
  - Prefix each line with a stable tag, e.g. `[vault:me]` / `[shared:@alice]`, **or** append a structured `details` object keyed by convention (prefer **one field per hit** if you attach parsed hits).
  - If **both** scopes appear in the result set, prepend one line: e.g. `Wiki search summary: N personal (me/), M shared across K collaborator tree(s): @a (…), @b (…).`
3. `**grep` tool** (`src/server/agent/tools/wikiSymlinkAwareGrep.ts` / `executeWikiSymlinkAwareGrep`): Same line-prefix or batch summary for `rel:line` output (same helper as find).
4. `**read` tool**: When the path resolves under `@*/`, optionally **prefix** the returned text with a single line: `Source: shared wiki @handle/…` (or append to first content block) so attribution survives after the model leaves the hit list.

Keep formatting **deterministic** and **grep-friendly** for tests (`toolResultIncludes` in evals).

### Phase 2 — Prompt

- Update `**src/server/prompts/assistant/base.hbs`**: Under wiki tools / shared pages, add a **hard rule**:
  - Paths under `@handle/` are **another user’s shared tree** (read-only).
  - When answering from those files, **state the source** in user-facing text.
  - For first-person questions (“my trip”, “my plan”), if evidence is only under `@*/`, **say that explicitly** and avoid implying sole ownership.
- Optionally tighten `**find` / `grep` `description`** strings in `wikiScopedFsTools.ts` to mention that **result lines are labeled** `vault` vs `shared` (so the model looks for the tag).

### Phase 3 — Optional follow-up

- `**scope` parameter** on `find`/`grep`: `me | all | @handle` (default `all`) for power users and for the LLM when the user clearly wants “only my vault.”
- UI cards: if tool `details` already surface in the client, mirror the same `scope` / `handle` fields for humans.

---

## Validation

### 1. Unit tests (required, fast)

- `**wikiToolProvenance`**: matrix of paths (`me/foo.md`, `./me/foo.md`, `@alice/bar.md`, edge cases).
- `**find`/`grep` post-processing**: golden strings — mixed result list produces **summary line** + **per-line tags**; single-scope lists do not spam (or still tag consistently — pick one rule and test it).
- Existing `**wikiScopedFsTools.test.ts`** / grep tests: extend with a temp `wikis/` tree (`me/` + `@peer/`) and assert tool output substrings.

These give **deterministic** coverage without API spend.

### 2. LLM JSONL evals (recommended)

Eval harness already supports `toolResultIncludes` / `finalTextIncludes` / `toolNamesIncludeAll` (`[src/server/evals/harness/types.ts](../../src/server/evals/harness/types.ts)`).

**Option A — Wiki / assistant parity case**

- Add a **small JSONL** suite (e.g. `eval/tasks/wiki-shared-provenance-v1.jsonl`) **or** one row in `eval/tasks/wiki-v1.jsonl` with agent `cleanup` or a **thin assistant runner** that:
  1. Seeds a directory tree under the eval wiki parent: `wikis/me/travel/ny.md` (minimal) **and** `wikis/@evalpeer/travel/ny-shared.md` (unique phrase, e.g. `EVAL_PEER_NYC_SECRET_TOK`).
  2. User message: e.g. “Search my wiki for `EVAL_PEER_NYC_SECRET_TOK` — is this **my** trip note or from someone else?”
  3. **Expect:**
    - `toolNamesIncludeOneOf`: `grep` or `find` + `read`
    - `toolResultIncludes`: provenance tag or `shared` / `@evalpeer` (match your chosen format)
    - `finalTextIncludesOneOf`: substrings that show attribution (`evalpeer`, `shared`, collaborator wording)

**Option B — Enron-scale assistant session**

- Today `**runEnronV1`** does not run `seedEnronEvalWiki()` per case; wiki-heavy Enron tasks rely on whatever wiki exists under the eval tenant. For a **shared** case you can either:
  - Extend `**eval:build` or eval bootstrap** to lay down `wikis/@evalpeer/…` under the same tenant tree used by Enron, **or**
  - Prefer **Option A** (isolated wiki case) to avoid coupling mail eval to wiki seeding.

**Running:** `EVAL_CASE_ID=<id> npm run eval:run -- …` or `npx tsx … wikiV1cli.ts --id …` per [eval/README.md](../../eval/README.md).

Flaky LLM cases should assert `**toolResultIncludes`** on **deterministic** tool output first; use `**finalTextIncludes`** only for strong attribution phrases to avoid model variance.

### 3. Manual / QA (quick)

- Two-account or fixture share: `grep` / `find` from `.` and confirm UI + model see tags.
- Ask “Find my …” when only a shared doc matches — assistant should **disambiguate**, not personalize.

---

## Risks / tradeoffs

- **Verbosity:** Per-line tags increase token count; mitigate with **short tags** (`[s:@a]` + one summary line) and only a batch summary when **mixed**.
- **Consistency:** `read` must use the **same** handle normalization as `find`/`grep`.
- **Legacy paths:** Bare paths rewritten to `me/` vs `@peer/` — provenance should reflect **resolved tool path**, not the user’s ambiguous string.

---

## Done when

- Helper + unit tests merged.
- `find` + `grep` (+ optional `read` header) emit stable provenance.
- `assistant/base.hbs` updated with attribution rule.
- At least one **automated** test or JSONL expectation locks the behavior.
- BUG-042 marked resolved / archived with pointer to this plan’s outcome.