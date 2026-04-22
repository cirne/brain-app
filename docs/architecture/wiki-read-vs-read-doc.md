# Wiki `read` vs `read_doc` — keep both

**Status:** Accepted  
**Scope:** brain-app agent tools (`src/server/agent/tools.ts`, system prompt in `src/server/agent/index.ts`)  
**See also:** [ARCHITECTURE.md](../ARCHITECTURE.md) (overview), [ripmail/docs/ARCHITECTURE.md](../../ripmail/docs/ARCHITECTURE.md) (ripmail crate)

---

## Context

The agent needs to read two different kinds of content:

1. **Markdown wiki pages** under `$BRAIN_WIKI_ROOT/wiki` (dev: `$BRAIN_HOME/wiki`) — the user’s edited, cross-linked **synthesized** knowledge (working source of truth for digested information).
2. **Email and indexed local files** from the ripmail SQLite index — **evidence** (messages by Message-ID, attachments, paths under configured folder sources) used to *inform* wiki pages, analogous to “read this email,” not “this file is the wiki.”

The codebase could theoretically expose a single “read file” tool with multiple roots or absolute paths. That would reuse `@mariozechner/pi-coding-agent` primitives for everything, but it blurs product semantics and mixes incompatible identifier and I/O models.

---

## Decision

Keep **two tool families**:

| Surface | Mechanism | Paths / IDs |
|--------|-----------|-------------|
| Wiki | `createReadTool` / `createEditTool` / … from `@mariozechner/pi-coding-agent`, scoped to `wikiDir` | Paths **relative to wiki root** (same contract as grep/find) |
| Indexed mail & files | `read_doc`, `search_index`, … — **`ripmail` CLI** (`ripmail read`, `ripmail search`, …) | **Message-ID** or **absolute filesystem path** (e.g. `~/…`); JSON from ripmail; local files get **extracted text** (PDF, etc.) as implemented in ripmail, not raw bytes through the wiki reader |

The system prompt instructs the model to use grep / find / `read` for wiki content vs `search_index` / `read_doc` for the index. Separate **tool names, descriptions, and parameters** encode the distinction without relying on path heuristics alone.

---

## Rationale

1. **Email is not a wiki path.** Identifiers are RFC Message-IDs (and thread semantics), not files under `wikiDir`.
2. **Extraction vs raw text.** PDFs and office formats are handled by ripmail’s extractors; the wiki `read` tool targets markdown/text in the vault.
3. **Avoid ambiguous schemas.** A single `read` with two roots would mix relative wiki paths and absolute disk paths unless the schema required an explicit discriminator (e.g. `kind: "wiki" | "source"`). Until/unless we introduce that unified API, **two tools** are clearer for the model.

---

## Security contract (BUG-012)

- **Wiki tools** (`read`, `edit`, `write`, `grep`, `find`): arguments are coerced through [`resolveSafeWikiPath`](../../src/server/lib/wikiEditHistory.ts) / [`coerceWikiToolRelativePath`](../../src/server/lib/wikiEditHistory.ts) before calling `@mariozechner/pi-coding-agent`, so paths stay under `wikiDir` (pi’s own resolver treats absolute paths as host paths).
- **`read_doc` filesystem branch:** only paths under the current tenant’s allowlist — `BRAIN_HOME`, ripmail home, wiki content directory, and configured `localDir` / `icsFile` roots from `ripmail sources list` — see [`agentPathPolicy.ts`](../../src/server/lib/agentPathPolicy.ts). Message-ID–style identifiers skip filesystem checks.
- **`GET /api/files/read`:** same allowlist as `read_doc` (all deployment modes).

Details and remaining OS-level gaps: [BUG-012](../bugs/BUG-012-agent-tool-path-sandbox-escape.md).

---

## Consequences

- **UI alignment:** `GET /api/files/read` uses the same `ripmail read <path> --json` pipeline as `read_doc` for filesystem paths; both use shared exec options in [`src/server/lib/ripmailReadExec.ts`](../../src/server/lib/ripmailReadExec.ts) (20 MiB `maxBuffer`, 120s timeout).
- **Operational:** `read_doc` runs `ripmail` via `exec`; Node’s default 1 MiB `maxBuffer` is insufficient for large JSON. The wiki file tools use separate I/O paths from pi-coding-agent.
- **Future:** A unified `read` with a required `kind` or `scope` field could replace the split while preserving explicit semantics; that would be a deliberate schema and prompt change, not “two directories on one tool.”

---

## Related code

- `createReadTool(wikiDir)` and custom tools: `src/server/agent/tools.ts`
- System prompt capabilities: `src/server/agent/index.ts`
- Raw file API: `src/server/routes/files.ts`
- Shared `ripmail read` exec limits: `src/server/lib/ripmailReadExec.ts`
