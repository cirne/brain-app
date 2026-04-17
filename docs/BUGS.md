# Bugs

Known issues discovered through development and usage. Root cause and fix direction included where known.

Fixed bugs are archived in [bugs/archive/](bugs/archive/).

### Ripmail crate (`ripmail/`)

The **ripmail** workspace member indexes its own bugs: **[`ripmail/docs/BUGS.md`](../ripmail/docs/BUGS.md)** with files under [`ripmail/docs/bugs/`](../ripmail/docs/bugs/) (and [`ripmail/docs/bugs/archive/`](../ripmail/docs/bugs/archive/)). `BUG-*` IDs there are **independent** from brain-app `BUG-*` in this file. When inbox, sync, or CLI behavior is owned by ripmail, file and link bugs under `ripmail/docs/`; when the bug is in the Hono/Svelte app or integration, it belongs here.

---

## Active


| ID      | Title                                   | Summary                                                                                                                                                                                                                                                               |
| ------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001 | Wiki/docs show `\u2014` or em dashes    | Unicode em dash (U+2014) sometimes appears as the literal escape `\u2014` in rendered text, and wiki copy often uses `—` where we prefer other punctuation.                                                                                                           |
| BUG-003 | Native Mac app ship blockers (Tauri)    | Bundled **Brain.app** is buildable, but shipping a **zero-config** DMG (FDA-only) is blocked by secrets/env, log visibility, and slow **tauri build** iteration. See [bugs/BUG-003-native-mac-app-ship-blockers.md](bugs/BUG-003-native-mac-app-ship-blockers.md).    |
| BUG-005 | Client UI: idiomatic Tailwind & reuse   | Tailwind v4 is wired, but styling mixes heavy scoped CSS + globals with inconsistent utilities; duplicated layouts and ad hoc `class` logic. Converge on theme tokens, shared primitives, and `tailwind-merge` / variants. See [bugs/BUG-005-tailwind-css-consolidation.md](bugs/BUG-005-tailwind-css-consolidation.md). |


### BUG-001: Escaped em dash and unwanted em dashes in docs

**Symptom**

- Markdown or UI sometimes shows the six-character sequence `\u2014` instead of any dash or separator.
- Separately, content uses the em dash character `—` (U+2014) between labels and glosses (e.g. `Partner — description`). Project preference is to avoid em dashes in prose and lists.

**What `\u2014` is**

- It is the JSON/Unicode escape for U+2014 (em dash). If you see the escape literally, the string was not decoded before display, or was double-escaped when stored.

**Likely sources**

- Wiki files under `$BRAIN_HOME/wiki`, including agent-written or pasted content.
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
| BUG-004 | Full Disk Access detection & onboarding | **Fixed:** Rust + Node TCC probes; Tauri `FullDiskAccessGate` (prod only) with System Settings deep link, poll, and `plugin-process` relaunch; `GET /api/onboarding/fda`; Messages `full_disk_access_hint` + grant control; startup line `Full Disk Access: granted` or `Full Disk Access: NOT granted`. Manual DMG checklist remains the release sign-off. See [bugs/BUG-004-full-disk-access-detection-and-onboarding.md](bugs/BUG-004-full-disk-access-detection-and-onboarding.md). |
| BUG-006 | Chat: concurrent POSTs same session → pi-agent error | **Fixed:** `await agent.waitForIdle()` before `subscribe` in `streamAgentSseResponse` (FIFO per `Agent`); covers chat + onboarding SSE. Tests: `streamAgentSse.test.ts`. See [bugs/archive/BUG-006-agent-concurrent-prompt.md](bugs/archive/BUG-006-agent-concurrent-prompt.md). |
| BUG-007 | Agent view: stream scroll stick-to-bottom | **Fixed:** `followOutput` in `AgentConversation.svelte` (scroll sync + `scrollToBottomIfFollowing`); SSE path uses `tick` + rAF. Unconditional `scrollToBottom` for load session and stream `finally`. Helpers in `scrollPin.ts`; tests: `scrollPin.test.ts`. See [bugs/BUG-007-agent-view-scroll-stick-to-bottom.md](bugs/BUG-007-agent-view-scroll-stick-to-bottom.md). |


### BUG-002 (archived): Chat — background stream hijacked the right panel

**Was:** Global detail state + unscoped SSE callbacks so a background run could open wiki/email/calendar for the wrong chat.

**Fix:** Per-session message/stream state and `isActiveSession()` guards on `onOpenWiki`, `onOpenFromAgent`, `onWriteStreaming`, `onEditStreaming`, and scroll; transcript still updates for background sessions.