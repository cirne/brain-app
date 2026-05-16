---
name: fix
description: End-to-end bug fix workflow for brain-app—read the bug spec, reproduce via regression tests (TDD) or JSONL agent evals when the failure is agent-shaped, implement the fix, verify, archive docs/BUGS.md hygiene, then commit skill. Use when the user invokes /fix, passes docs/bugs/BUG-NNN-….md, or asks to fix a tracked bug; pause and ask the user for repro details when an eval or test cannot be made to fail.
---

# Fix (bug workflow)

Use this when fixing a **canonical** bug under **`docs/bugs/`** (e.g. **`docs/bugs/BUG-058-brain-query-privacy-templates-filter-not-relevance.md`**).

Early-development expectations for bugs are in **[`AGENTS.md`](../../../AGENTS.md)** (**TDD**: failing automated check first when practical).

## Workflow

1. **Read the bug** — Open the given **`docs/bugs/BUG-NNN-….md`**. Note symptom, repro, expected behavior, scope, and links.
2. **Reproduce (TDD)** — Choose the smallest automated repro that matches the bug shape:
   - **Agent failures** (wrong tool use, bad final answer, harness-visible agent loop, mail/wiki/agent eval regressions): add or extend a **JSONL agent eval** task (see **[`../brain-app-evals/SKILL.md`](../brain-app-evals/SKILL.md)** and **[`eval/README.md`](../../../eval/README.md)** — explore-then-assert, **`npm run eval:run -- --id <task-id>`**). Prefer the suite that matches the scenario (**`eval/tasks/enron-v1.jsonl`**, **`mail-compose-v1.jsonl`**, **`wiki-v1.jsonl`**, **B2B** JSONL under **`eval/tasks/`**, etc.).
   - **Everything else** (pure logic, routing, persistence, UI plumbing): add one or more **new** **`src/**/*.test.ts`** (or **`ripmail/`** / **`desktop/`**) tests that **fail** on current code.
   - **Blocked reproduction** — If you cannot get a failing eval **or** failing test after a reasonable attempt (missing corpus state, unclear user message, non-determinism, insufficient repro steps), **stop and ask the user** for concrete reproduction details (exact prompt, tenant/fixtures, model, trace snippet, expected vs actual). Do not guess the fix without a red repro.
3. **Fix the bug** — Implement the minimal change that satisfies the spec and the new repro (eval assertions or tests).
4. **Verify** — Until green: **eval path** — single-case then broader **`npm run eval:run`** as appropriate; **test path** — scoped Vitest/cargo; plus **`npm run lint`** / **`npm run typecheck`** when **`src/`** changed (full matrix: **[`../commit/SKILL.md`](../commit/SKILL.md)**).
5. **Archive the bug** — Follow **[`../backlog/SKILL.md`](../backlog/SKILL.md)** **Close and archive**:
   - Set final **`Status:`** in the bug body (e.g. Fixed).
   - **`git mv`** the file to **`docs/bugs/archive/`**.
   - Update **`docs/BUGS.md`**: remove the **`## Active`** subsection for this id; add (or refresh) a **`## Fixed (archived)`** entry with link **`bugs/archive/BUG-NNN-….md`** and a one-line fix/archive note consistent with nearby rows.
   - **`grep`** for **`BUG-NNN`**, old paths, and `#fragment` links; fix cross-references.
6. **Commit** — Follow **[`../commit/SKILL.md`](../commit/SKILL.md)** (`/commit`): staged verification, commit message, **`git fetch`** + **`git push`** for the current branch when applicable.

## When automation is still impractical after user input

If reproducibility remains blocked (flaky externals, hardware-only, secret-dependent prod-only behavior), document that in the bug before closing, record **manual** verification, and keep **`docs/BUGS.md`** accurate.

## Related

- [`docs/BUGS.md`](../../../docs/BUGS.md)
- [`../brain-app-evals/SKILL.md`](../brain-app-evals/SKILL.md)
- [`eval/README.md`](../../../eval/README.md)
- [`../backlog/SKILL.md`](../backlog/SKILL.md)
- [`../commit/SKILL.md`](../commit/SKILL.md)
