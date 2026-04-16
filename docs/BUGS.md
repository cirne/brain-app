# Bugs

Known issues discovered through development and usage. Root cause and fix direction included where known.

Fixed bugs are archived in [bugs/archive/](bugs/archive/).

---

## Active


| ID      | Title                                | Summary                                                                                                                                                     |
| ------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001 | Wiki/docs show `\u2014` or em dashes | Unicode em dash (U+2014) sometimes appears as the literal escape `\u2014` in rendered text, and wiki copy often uses `—` where we prefer other punctuation. |
| BUG-003 | Native Mac app ship blockers (Tauri) | Bundled **Brain.app** is buildable, but shipping a **zero-config** DMG (FDA-only) is blocked by secrets/env, log visibility, and slow **tauri build** iteration. See [bugs/BUG-003-native-mac-app-ship-blockers.md](bugs/BUG-003-native-mac-app-ship-blockers.md). |
| BUG-004 | Full Disk Access detection & onboarding | App has **no runtime FDA detection**, no guided prompt, and no relaunch after granting. Users get silent failures on iMessage/Notes/Mail. See [bugs/BUG-004-full-disk-access-detection-and-onboarding.md](bugs/BUG-004-full-disk-access-detection-and-onboarding.md). |


### BUG-001: Escaped em dash and unwanted em dashes in docs

**Symptom**

- Markdown or UI sometimes shows the six-character sequence `\u2014` instead of any dash or separator.
- Separately, content uses the em dash character `—` (U+2014) between labels and glosses (e.g. `Partner — description`). Project preference is to avoid em dashes in prose and lists.

**What `\u2014` is**

- It is the JSON/Unicode escape for U+2014 (em dash). If you see the escape literally, the string was not decoded before display, or was double-escaped when stored.

**Likely sources**

- Wiki files in `WIKI_DIR` (external brain repo), including agent-written or pasted content.
- LLM outputs that default to em dashes between clauses or after titles.
- Any path that round-trips markdown through JSON without proper Unicode handling.

**Expected**

- Readers should never see the literal `\u2014`.
- Editorial style: prefer hyphens, colons, parentheses, or new lines over em dashes in wiki and agent-generated markdown (team avoids em dashes).

**Fix direction**

- If the bug is **rendering**: trace where markdown or tool results are embedded in JSON/SSE/HTML and ensure strings are decoded once; add a regression test if there is a reproducible path in-app.
- If the bug is **content**: bulk-replace or gradually edit wiki sources; tighten agent prompts (e.g. onboarding, `write`/`edit` instructions) to use allowed separators only.
- Optional: a small wiki lint or grep in CI for the em dash character or for the literal six-character Unicode escape (backslash, `u`, `2`, `0`, `1`, `4`) in stored text that should already be decoded (only if the team wants enforcement).

---

## Fixed (archived)


| ID      | Title                                            | Summary                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-002 | Chat: background stream hijacked the right panel | **Fixed:** Multi-session state in `AgentChat` (`chatSessionStore.ts` Map per session key); `consumeAgentChatStream` takes `isActiveSession` and skips panel-only callbacks when the user is viewing another chat. Background streams keep updating transcript; `pending:` keys migrate to server `sessionId` on SSE `session` event. Tests: `chatSessionStore.test.ts`, `agentStream.test.ts`, `agentChatMultiSession.test.ts`. |


### BUG-002 (archived): Chat — background stream hijacked the right panel

**Was:** Global detail state + unscoped SSE callbacks so a background run could open wiki/email/calendar for the wrong chat.

**Fix:** Per-session message/stream state and `isActiveSession()` guards on `onOpenWiki`, `onOpenFromAgent`, `onWriteStreaming`, `onEditStreaming`, and scroll; transcript still updates for background sessions.