# Wiki `read` vs indexed mail/files (`read_mail_message` / `read_indexed_file`) — keep both

**Status:** Accepted  
**Scope:** brain-app agent tools (`src/server/agent/tools.ts`, system prompt in `src/server/agent/index.ts`)  
**See also:** [ARCHITECTURE.md](../ARCHITECTURE.md) (overview), [`src/server/ripmail/`](../../src/server/ripmail/index.ts) (implementation), [ripmail-rust-snapshot.md](./ripmail-rust-snapshot.md) (archived Rust crate docs)

---

## Context

The agent needs to read two different kinds of content:

1. **Markdown wiki pages** under `$BRAIN_WIKI_ROOT/wiki` (dev: `$BRAIN_HOME/wiki`) — the user’s edited, cross-linked **synthesized** knowledge (working source of truth for digested information).
2. **Email and indexed local files** from the ripmail SQLite index — **evidence** (messages by Message-ID, attachments, paths under configured folder sources) used to *inform* wiki pages, analogous to “read this email,” not “this file is the wiki.”

This split is a reliability contract, not just a tool-routing detail:

- **Wiki = synthesis / working memory.** It orients the assistant around people, projects, vocabulary, and prior conclusions.
- **Email = primary evidence.** It contains the raw thread text, attachments, dates, commitments, and final wording.
- **Dates resolve conflicts.** When source messages disagree about a current-state fact, the newest relevant dated source normally wins; older messages become historical context unless newer evidence confirms they still apply.
- **Wiki is always a work in progress.** A wiki hit should shape subsequent lookup, not automatically terminate lookup. For high-stakes or evolving facts (travel times, decisions, commitments, project status, roles), the agent should verify or enrich from `search_index` / `read_mail_message` / `read_indexed_file`.

The codebase could theoretically expose a single “read file” tool with multiple roots or absolute paths. That would reuse `@mariozechner/pi-coding-agent` primitives for everything, but it blurs product semantics and mixes incompatible identifier and I/O models.

---

## Decision

Keep **two tool families**:

| Surface | Mechanism | Paths / IDs |
|--------|-----------|-------------|
| Wiki | `createReadTool` / `createEditTool` / … from `@mariozechner/pi-coding-agent`, scoped to `wikiDir` | Paths **relative to wiki root** (same contract as grep/find) |
| Indexed mail & files | `read_mail_message`, `read_indexed_file`, `search_index`, … — **ripmail-backed** (`ripmail read`, `ripmail search`, … or in-process `@server/ripmail` equivalents on hot paths) | **`read_mail_message`:** RFC Message-ID only (mail bodies). **`read_indexed_file`:** indexed Drive/file **`messageId`** or **absolute filesystem path** under tenant allowlist (e.g. `~/…`); JSON from ripmail; local files get **extracted text** (PDF, etc.) as implemented in ripmail, not raw bytes through the wiki reader |

**Remote corpus reads (Drive, future Notion-style sources):** search hits come from **local FTS** on **bounded** synced text + metadata; **`read_doc` / `read_indexed_file`** paths for remote ids should treat the provider as **authoritative** for full body—**fetch on read** with a **short TTL cache** (~10 minutes target), not “SQLite holds the full document forever.” See [external-data-sources.md](./external-data-sources.md).

The system prompt instructs the model to use grep / find / `read` for wiki content vs `search_index` plus **`read_mail_message` / `read_indexed_file`** for the index. Separate **tool names, descriptions, and parameters** encode the distinction without relying on path heuristics alone.

The prompt should say **wiki first** as an orientation step, not as a stopping rule. Current-state answers and wiki writes should reconcile the wiki with source evidence, especially when broad search results span dates or conflict.

---

## Rationale

1. **Email is not a wiki path.** Identifiers are RFC Message-IDs (and thread semantics), not files under `wikiDir`.
2. **Extraction vs raw text.** PDFs and office formats are handled by ripmail’s extractors; the wiki `read` tool targets markdown/text in the vault.
3. **Avoid ambiguous schemas.** A single `read` with two roots would mix relative wiki paths and absolute disk paths unless the schema required an explicit discriminator (e.g. `kind: "wiki" | "source"`). Until/unless we introduce that unified API, **two tools** are clearer for the model.
4. **Trust depends on temporal accuracy.** For factual synthesis, especially travel, scheduling, roles, decisions, and commitments, stale but relevant-looking evidence is dangerous. Search can surface old and new messages together, so agents and tool output must explicitly remind models that newest relevant evidence governs the current state.

---

## Security contract (BUG-012)

- **Wiki tools** (`read`, `edit`, `write`, `grep`, `find`): arguments are coerced through [`resolveSafeWikiPath`](../../src/server/lib/wikiEditHistory.ts) / [`coerceWikiToolRelativePath`](../../src/server/lib/wikiEditHistory.ts) before calling `@mariozechner/pi-coding-agent`, so paths stay under `wikiDir` (pi’s own resolver treats absolute paths as host paths).
- **`read_indexed_file` filesystem branch:** only paths under the current tenant’s allowlist — `BRAIN_HOME`, ripmail home, wiki content directory, and configured `localDir` / `icsFile` roots from `ripmail sources list` — see [`agentPathPolicy.ts`](../../src/server/lib/agentPathPolicy.ts). Indexed **`messageId`** values resolve via ripmail without treating them as arbitrary disk paths.
- **`GET /api/files/read`:** same allowlist as `read_indexed_file` for filesystem paths (all deployment modes).

Details and remaining OS-level gaps: [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md); historical **[BUG-012 (archived)](../bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md)**.

---

## Consequences

- **UI alignment:** `GET /api/files/read` uses the same `ripmail read <path> --json` pipeline as `read_indexed_file` for filesystem paths; indexed reads use shared exec options in [`src/server/lib/ripmailReadExec.ts`](../../src/server/lib/ripmailReadExec.ts) (20 MiB `maxBuffer`, 120s timeout).
- **Operational:** `read_mail_message` / `read_indexed_file` run `ripmail read` via `exec`; Node’s default 1 MiB `maxBuffer` is insufficient for large JSON. The wiki file tools use separate I/O paths from pi-coding-agent.
- **Future:** A unified `read` with a required `kind` or `scope` field could replace the split while preserving explicit semantics; that would be a deliberate schema and prompt change, not “two directories on one tool.”

---

## Related code

- `createReadTool(wikiDir)` and custom tools: `src/server/agent/tools.ts`
- System prompt capabilities: `src/server/agent/index.ts`
- Raw file API: `src/server/routes/files.ts`
- Shared `ripmail read` exec limits: `src/server/lib/ripmailReadExec.ts`
