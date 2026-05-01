# BUG-012: Agent tools can read paths outside the current Brain home (cross-tenant / host FS leak)

## Severity

**Critical — data isolation / unauthorized disclosure**

## Status

**Open (app layer mitigated, 2026-04)** — in-process path jailing and tests are in place for the main agent and HTTP file read surfaces. **OS-level tenant isolation** (see [tenant filesystem isolation](../architecture/tenant-filesystem-isolation.md)) is still out of scope for this bug; a **Node RCE** or similar would bypass app-only checks.

## Progress (app layer)

| Area | State |
| ---- | ----- |
| **Shared allowlist** | [`src/server/lib/resolveTenantSafePath.ts`](../../src/server/lib/resolveTenantSafePath.ts) — `normalizePathThroughExistingAncestors` (macOS `/var` vs `/private/var` for non-existent leaves), `isAbsolutePathAllowedUnderRoots`, `isPathStrictlyInsideOrEqual`. |
| **Policy module** | [`src/server/lib/agentPathPolicy.ts`](../../src/server/lib/agentPathPolicy.ts) — `read_indexed_file` path allowlist = tenant `BRAIN_HOME` + `ripmail` home + `wiki` content dir + `localDir` / `icsFile` paths from `ripmail sources list --json`; `manage_sources` add/edit blocks paths that overlap **sibling** tenant dirs under `BRAIN_DATA_ROOT` and (in MT) paths under the data root that are not in the read allowlist. |
| **`read_mail_message` / `read_indexed_file`** | **`read_indexed_file`:** filesystem-like `id` values are checked before `ripmail read`. **`read_mail_message`:** RFC Message-ID arguments only (no path branch). |
| **`manage_sources`** | Path validated before CLI spawn. |
| **Wiki / pi tools** | [`coerceWikiToolRelativePath`](../../src/server/lib/wikiEditHistory.ts) + wrapped `read` / `edit` / `write` / `grep` / `find` in [`tools.ts`](../../src/server/agent/tools.ts) so pi’s `resolveToCwd` cannot accept raw host absolutes outside `wikiDir`. Upstream [`path-utils`](https://github.com/mariozechner/pi-coding-agent) still resolves absolute paths as-is; our wrapper prevents that class of escape. |
| **`GET /api/files/read`** | Uses the same allowlist as agent reads in **all** modes (no longer MT-only). |
| **Tests** | [`agentPathPolicy.test.ts`](../../src/server/lib/agentPathPolicy.test.ts), [`readEmailPathPolicy.test.ts`](../../src/server/agent/readEmailPathPolicy.test.ts), [`manageSources.test.ts`](../../src/server/agent/manageSources.test.ts) (incl. MT sibling), extended [`resolveTenantSafePath.test.ts`](../../src/server/lib/resolveTenantSafePath.test.ts). |

### Still open / later

- **Kernel / VM / UID / Landlock** isolation for high-density hosted Brain ([architecture doc](../architecture/tenant-filesystem-isolation.md)).
- **Symlink hardening** for wiki-only `resolveSafeWikiPath` if a wiki path links outside the vault (optional `realpath` proof).
- **Operational:** indexed-folder allowlist requires a successful `ripmail sources list` subprocess when rejecting paths outside brain/ripmail/wiki (acceptable tradeoff).

## Summary

The in-app agent is instructed to be helpful with files and email. Several tool surfaces accept **arbitrary absolute filesystem paths** (or pass user-controlled strings to subprocesses with full process privileges). A user can describe another person’s data area in natural language (e.g. “list everything under `/brain-data/dwilcox`”) without naming an attack explicitly. The model may invoke tools that **walk, list, and read** content **outside the current user’s `BRAIN_HOME` / tenant slice**, as long as the OS user running Brain can read those paths.

This is a **confidentiality** failure for:

- **Multi-tenant** layouts where `BRAIN_DATA_ROOT` holds multiple workspace directories under one host user (see `src/server/lib/dataRoot.ts`).
- **Any** deployment where the Brain process is more privileged than the “logical” user (e.g. shared service account, overly broad `755` on parent directories, or future hosted Brain).

It is not limited to a malicious *human* user: **prompt injection** via synced email, wiki, or chat could steer the same tools toward sensitive paths if the process can reach them.

## Evidence in codebase (snapshot before mitigation; see **Progress** above for current code)

| Area                                                 | Concern                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_indexed_file` (filesystem branch)                                           | Documented to accept **indexed file/Drive `messageId`** or “**a file by absolute path (tilde paths OK)**” and passes eligible ids through to `ripmail read` — historically lacked checks that arbitrary paths stay under the current `RIPMAIL_HOME` / `BRAIN_HOME` / configured sources (`src/server/agent/tools.ts`). **Mitigated:** allowlist enforcement in agent path policy.                                                                                                                                                                        |
| `manage_sources`                                     | `op=add` / `op=edit` take `**path: absolute path or ~`** — same class of issue for registering or editing folder sources.                                                                                                                                                                                                                                                                                                 |
| Wiki file tools from `@mariozechner/pi-coding-agent` | `createReadTool`, `createFindTool`, etc. are scoped with a `wikiDir` string. **If** the upstream implementation uses standard path joins (e.g. `path.resolve(wikiDir, userPath)`), a **path argument that is already absolute** can reset the base and escape the wiki root (Node: `path.resolve('/wiki', '/etc/passwd')` → `/etc/passwd`). **Confirm upstream behavior;** if unguarded, this is a direct sandbox escape. |
| Custom tools using `resolveSafeWikiPath`             | `move_file` / `delete_file` and wiki edit history use `**resolveSafeWikiPath`** in `src/server/lib/wikiEditHistory.ts`, which **rejects** traversals outside `wikiDir` — **good pattern** to generalize.                                                                                                                                                                                                                  |


## Threat model (what we must assume)

- The agent **must not** read, list, or exfiltrate data outside a defined **allowlist of roots** for the current session (at minimum: current tenant’s `BRAIN_HOME`, resolved `BRAIN_WIKI_ROOT` / wiki, `RIPMAIL_HOME`, and explicit configured source paths — **not** arbitrary siblings under `BRAIN_DATA_ROOT`).
- Attackers: malicious local user, mistyped or social-engineered paths, or **untrusted content** in prompts.
- The **pi coding agent** stack (`@mariozechner/pi-coding-agent`) is optimized for single-project coding assistants; it does not, by itself, provide **multi-tenant OS-level isolation**. Treating it as a security boundary without additional enforcement is **unsafe**.

## Fix directions to consider (design space)

### 1. Path canonicalization + allowlist (in-process, every tool)

- Resolve user input with `path.resolve` only **after** rejecting or stripping **absolute** paths **or** re-rooting them under an allowlist.
- After `realpath` / `fs.realpath`, require  
`realpathResult === allowlistedRoot || realpathResult.startsWith(allowlistedRoot + path.sep)`.
- Reject `..` segments in **logical** path handling before touch; do not rely on the model to send “safe” relative paths.
- **Pros:** Works in one Node process; can wrap both custom tools and pi primitives if we fork or wrap at registration time. **Cons:** Every new tool must call the same helper — easy to miss without lint/tests.

### 2. “No raw absolute paths” policy (strict)

- Refuse tool parameters that look like absolute paths (`/` on POSIX, `\\` on Windows, drive letters) **unless** they are first normalized and verified to sit under an allowlist (see (1)).
- For `read_indexed_file`-style file reads, only accept:
  - **message IDs** for mail, and/or  
  - **repo-relative** paths under configured indexed roots, or opaque ids mapped server-side to paths.
- **Pros:** Simple mental model. **Cons:** Breaks some power-user flows unless we add explicit per-source “path roots” in config that are themselves allowlisted.

### 3. Always prepend `BRAIN_HOME` (or tenant home) for “relative” operations

- Only allow paths relative to a single root; **never** pass user-controlled strings as the second argument to `resolve` if they can be absolute (see Node behavior above).
- **Pros:** Prevents accidental escape if implemented with `path.join(allowedRoot, ...segments)` and segment validation. **Cons:** Does not by itself protect **intentional** absolute paths; must pair with (1) or (2).

### 4. OS- / process-level isolation (strongest, heavier)

- Run agent-facing tool execution in a **separate Unix user**, **container**, **jail / seatbelt / Landlock** (where available), or **separate VM**, with:
  - filesystem views limited to the current tenant’s tree, and  
  - no read access to sibling tenants under `BRAIN_DATA_ROOT`.
- **Pros:** Defense in depth even if a path check is buggy once. **Cons:** packaging and ops cost; the **pi** / Node in-process model may not map cleanly to subprocess-per-request without a redesign; still need strict API between UI and tool runner.

### 5. Multi-tenant product stance

- If hosted or shared **Brain** is a goal, document that **in-process path checks + pi** are **insufficient** as the only layer; at least one of **(4)** or **strict per-tenant subprocess with FS namespaces** is required for a strong guarantee.
- Consider **failing closed**: disable `read_indexed_file` for filesystem paths in multi-tenant mode until re-rooted; keep **`read_mail_message`** Message-ID-only.

## Recommended next steps (engineering)

1. **Inventory** all tools in `src/server/agent/tools.ts` and upstream pi tools for any `path`, `id`, or shell argument that reaches `fs`, `child_process`, or `ripmail`.
2. **Centralize** a `assertPathUnderRoots(candidate: string, roots: string[]): string` (or equivalent) and unit tests (symlinks, `..`, absolute inputs, Windows paths if applicable).
3. **Align** with `resolveSafeWikiPath` semantics where appropriate; consider exporting a shared module used by wiki tools, `read_mail_message` / `read_indexed_file`, and ripmail source management.
4. **Upstream:** confirm `@mariozechner/pi-coding-agent` read/write/find/grep behavior for absolute `path` parameters; if unguarded, **wrap** or **patch** to enforce roots before `execute`.
5. **Add regression tests** that simulate a prompt requesting another tenant’s base path and expect **refusal** or **empty** result.

## Related docs

- [Tenant filesystem isolation (architecture)](../architecture/tenant-filesystem-isolation.md) — layered strategies (kernel, process, app) that close or bound this class of failure; complements the fix directions below.
- [Wiki read vs indexed mail/files](../architecture/wiki-read-vs-read-email.md) — intentional split between wiki-relative tools and **`read_mail_message` / `read_indexed_file`**; the security contract for “where files may live” should be made explicit and enforced.
- [OPP-012: Brain home data layout](../opportunities/OPP-012-brain-home-data-layout.md), [OPP-024: Split brain data](../opportunities/OPP-024-split-brain-data-synced-wiki-local-ripmail.md) — data roots.
- `src/server/lib/dataRoot.ts` — `BRAIN_DATA_ROOT`, `tenantHomeDir`.

