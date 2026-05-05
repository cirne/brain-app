# BUG-001: Escaped em dash and unwanted em dashes in docs

**Status:** Archived (2026-05-05). Typographic / rendering hygiene; no longer prioritized as an active bug (re-file if it blocks shipping copy).

## Symptom

- Markdown or UI sometimes shows the six-character sequence `\u2014` instead of any dash or separator.
- Separately, content uses the em dash character `—` (U+2014) between labels and glosses (e.g. `Partner — description`). Project preference is to avoid em dashes in prose and lists.

## What `\u2014` is

It is the JSON/Unicode escape for U+2014 (em dash). If you see the escape literally, the string was not decoded before display, or was double-escaped when stored.

## Likely sources

- Wiki files under `$BRAIN_HOME/wiki`, including agent-written or pasted content.
- LLM outputs that default to em dashes between clauses or after titles.
- Any path that round-trips markdown through JSON without proper Unicode handling.

## Expected

- Readers should never see the literal `\u2014`.
- Editorial style: prefer hyphens, colons, parentheses, or new lines over em dashes in wiki and agent-generated markdown (team avoids em dashes).

## Fix direction

- If the bug is **rendering**: trace where markdown or tool results are embedded in JSON/SSE/HTML and ensure strings are decoded once; add a regression test if there is a reproducible path in-app.
- If the bug is **content**: bulk-replace or gradually edit wiki sources; tighten agent prompts (e.g. onboarding, `write`/`edit` instructions) to use allowed separators only.
- Optional: a small wiki lint or grep in CI for the em dash character or for the literal six-character Unicode escape (backslash, `u`, `2`, `0`, `1`, `4`) in stored text that should already be decoded (only if the team wants enforcement).