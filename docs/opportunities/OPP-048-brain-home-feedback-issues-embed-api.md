# OPP-048: Feedback issues in `BRAIN_HOME` + embed-key API + `/feedback` skill

**Tags:** `desktop`, `server`, `agent-ergonomics`

## Summary

Ship a **default `/feedback` skill** so users can submit **bugs or feature requests** in natural language, while the product stores **issues** (internal name) on disk in a place **coding agents can read** without Slack or email. Each submission is **materialized as a file** under `**BRAIN_HOME`**, with a **dedicated LLM pass** to **strip PII**, **summarize**, and add **repro guidance** from recent chat context. **HTTP endpoints** (list + fetch by id) protect access with **`Authorization: Bearer` + `BRAIN_EMBED_MASTER_KEY`** so local automation and the agent harness can pull the same data as `npm` scripts. **To users, copy stays “feedback”;** code, paths, and APIs use **issues** for clarity in triage and `docs/bugs/`.

**Related:** [OPP-012](OPP-012-brain-home-data-layout.md) (`BRAIN_HOME`, `shared/brain-layout.json`); [archived OPP-030](archive/OPP-030-agent-driven-support-bug-to-pr.md) (full snag→PR automation deprioritized—this is a **narrow, local-first** step); [docs/BUGS.md](../BUGS.md) (triage target).

**Status:** Proposed; core pieces shipped. **Global queue** in multi-tenant: canonical files under `$BRAIN_DATA_ROOT/.global/issues/`; per-user copy under each tenant’s `issues/`; **`wiki/feedback/issue-<id>.md`** in the reporter’s vault wiki; `GET` with `BRAIN_EMBED_MASTER_KEY` lists the global namespace.

---

## Problem

- Small test cohorts and early users **report friction** in chat, but **ad hoc** exports are hard for **this repo’s coding agent** to consume: no single path, no schema, PII in raw transcripts.
- A future **agent-friendly support** service is out of scope **short term**; we still need a **boring, inspectable** queue that **lists**, **fetches**, and **converts to `docs/bugs/`** or reproduction steps.
- We already standardize on **`BRAIN_HOME`** for durable app data; feedback should not require a new cloud or third-party queue for the first iteration.

---

## Proposed design

### 1. Storage: `issues/` under `BRAIN_HOME` (not user-mail–specific)

- Add a canonical segment (e.g. `**issues**`) in [`shared/brain-layout.json`](../../shared/brain-layout.json) and wire Node/Tauri/ripmail alignment per OPP-012.
- **Contents are metadata and redacted/summarized report bodies**—not raw vault or mail payloads. The composing agent is responsible for **minimizing** user-specific or mailbox-identifying content; optional small **non-identifying** build metadata (app version, OS, build channel) is welcome.
- **File naming:** sortable, unique, and easy to reference: **`{ISO8601-timestamp}-issue-{n}.md`** (or `.json` frontmatter + markdown body if we want structured fields in one file). The numeric **`n`** is a **monotonic id** (per-brain or global counter file under `var/`—implementation detail) so agents can say “fetch issue `42`” without parsing timestamps.
- **Optional:** a tiny index file (e.g. `issues/index.json` last-N pointers) for fast list; if omitted, **list = sorted glob** on the server.

### 2. API: list + fetch, bearer `BRAIN_EMBED_MASTER_KEY`

- **Auth:** `Authorization: Bearer <token>` where `<token>` equals the server’s configured **`BRAIN_EMBED_MASTER_KEY`** (same secret class already used for Tauri-embedded key material; document that **only local-trust callers** use this—Loopback or operator tooling, not a public product surface).
- **Routes (illustrative):** `GET /api/.../issues` → list (ids, titles, createdAt); `GET /api/.../issues/:id` → full body + metadata. Exact path under existing Hono `runtime-and-routes` conventions TBD.
- **Behavior:** read-only in v1; **create** is via the **agent/tool path** that writes the file after the feedback agent runs, or a dedicated `POST` that accepts pre-redacted JSON—implementation can choose one write path, but **on-disk** remains source of truth.

### 3. Composing agent (new or specialized prompt)

- **Input:** user message + bounded recent **chat transcript** + optional “include last tool errors” (structured, not full logs).
- **Output:** a single **issue document** (markdown) with: type (bug / feature), title, summary, **repro steps** (or “unclear”), **redaction** pass (emails, names, phone, tokens → placeholders).
- **User review** before commit: the skill should show the **draft** and confirm **write**; align with the consent model in [archived OPP-030](archive/OPP-030-agent-driven-support-bug-to-pr.md) (no silent upload; explicit submit).

### 4. User-facing: `/feedback` skill

- **User copy:** e.g. “Submit **feedback**—bugs or feature requests.” Implementation and docs for maintainers: **issues** under `BRAIN_HOME`, **issue** ids in API.
- Ship as a **default skill** in the skill pack so new brains get the path without manual setup; optional: symlink or copy to `$BRAIN_HOME/skills/feedback/`.

### 5. Dev ergonomics: `npm` targets

- **`npm run` scripts** (names TBD) that call the same HTTP list/fetch (or a thin TS util over the filesystem) with **`BRAIN_EMBED_MASTER_KEY`** from the environment, so a developer or **Cursor agent** can run e.g. **`npm run issues:list`** and **`npm run issues:fetch -- 42`** without hand-curling. Exact script names can mirror public wording (**`feedback:`***) if we prefer the CLI to say “feedback” and the implementation to call the issues API.

---

## Security and non-goals

- **Bearer is not a multi-user auth story** for the open internet: bind server to **loopback** by default; document **LAN** exposure tradeoffs (see [OPP-035](OPP-035-local-vault-password-and-session-auth.md) patterns).
- **PII:** LLM redaction is best-effort; user-visible draft + short disclaimer remains important.
- **Non-goal v1:** automated triage, GitHub/Linear sync, or user email notifications; those layer on later.
- Revisit overlap with [archived OPP-010](archive/OPP-010-user-skills.md) (user skills) if `/feedback` becomes the first shipped default skill.

---

## Implementation checklist (when picked up)

1. `brain-layout.json` + path helpers + ensure `issues/` is created.
2. Issue file format + monotonic id assignment.
3. Hono routes + bearer check against `BRAIN_EMBED_MASTER_KEY`.
4. Tool or server handler that invokes the **feedback-composer agent** and writes the file.
5. Default `SKILL.md` for `/feedback` (user wording: feedback; dev: issues).
6. `package.json` scripts for list/fetch.
7. Cross-link from [AGENTS.md](../../AGENTS.md) or [docs/architecture/runtime-and-routes.md](../architecture/runtime-and-routes.md) (wherever embed + API keys are described).

---

## References

- [`shared/brain-layout.json`](../../shared/brain-layout.json)
- [`.env.example`](../../.env.example) — `BRAIN_EMBED_MASTER_KEY`
- [docs/bugs/](../bugs/) — triage output
