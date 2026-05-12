# Shared context: Enron demo corpora (all personas)

**Use when authoring:** JSONL and integration **evals** that run against **CMU Enron** fixture **mail** under **`./data/usr_enrondemo…`**. Some tasks also use **wiki tools**—see [Wiki state and eval assertions](#wiki-state-and-eval-assertions) below.

Pair with a **persona brief**: [Steven Kean](./persona-demo-steve-kean.md), [Kenneth Lay](./persona-demo-ken-lay.md), [Jeff Skilling](./persona-demo-jeff-skilling.md).

---

## Corpus snapshot and assistant date anchor

- **Indexed mail** spans roughly **1999–2001** (and edges of adjacent years depending on message). The fixture snapshot aligns with the **CMU Enron** release: treat the **latest realistic mail** as **through calendar year 2001** — i.e. **no 2002+ mail** in the corpus (corpus **as-of** roughly **2001-12-31**).
- **Product behavior (Enron demo tenants):** registered demo workspaces pin the assistant’s calendar **“today”** to **2002-01-01** so **relative dates** (“last week”, tool windows like `7d`, “tomorrow”) line up with **the day after** the corpus rather than wall clock. The system prompt states that this date is **authoritative** and that indexed mail is **historical fixture** data.

  Implementation pointers:

  - [`buildDateContext`](../../src/server/agent/agentFactory.ts) in `agentFactory.ts` — Enron demo tenants use **2002-01-01** and a **demo / fixture workspace** note.
  - [`ENRON_DEMO_CLOCK_ANCHOR_MS`](../../src/server/lib/auth/enronDemo.ts) — instant used for the prompt clock in demo tenants.
- **Eval harness:** Enron v1 defaults **`EVAL_ASSISTANT_NOW`** to **`2002-01-01`** when unset (see [`runEnronV1.ts`](../../src/server/evals/runEnronV1.ts), [`resolveEvalAnchoredNow`](../../src/server/lib/llm/evalAssistantClock.ts)).

**Authoring implication:** Tasks may use **relative** windows that assume **yesterday** was **2001-12-31**; agents should **not** contradict pinned **2002-01-01** “today.”

---

## Wiki state and eval assertions

**Do not assume** that any **wiki file**, **title**, or **path** exists before a case runs. Product sessions may create pages with arbitrary naming; **persona briefs** and **chat exports** must **not** be treated as guarantees about on-disk wiki layout.

**Allowed patterns**

- **Mail-only expectations** — `search_index`, `read_mail_message`, substrings in tool results, message ids. No wiki required.
- **Wiki expectations only after setup** — the **same** agent turn (or explicit harness/fixture step) **creates or overwrites** the file you assert on (e.g. user asks to save to `topics/eval-…` and `expect` checks tool output or a follow-up read). Prefer **namespaced** paths such as `topics/eval-…` for tasks that intentionally mutate the vault, to limit collisions with human-created content.
- **Wiki-only harnesses** (e.g. isolated `BRAIN_WIKI_ROOT`) — treat bundled fixtures as the **only** source of truth for paths in those suites.

If an eval fails because the wiki was **empty**, that is expected unless the eval **defined** the prerequisite state.

---

## Demo tenants (registry)

| Workspace handle | `tenantUserId` (under `BRAIN_DATA_ROOT`) | Maildir user (tarball) | Primary fixture email |
|------------------|----------------------------------------|-------------------------|-------------------------|
| `demo-steve-kean` | `usr_enrondemo00000000001` | `kean-s` | `steven.kean@enron.com` |
| `demo-ken-lay` | `usr_enrondemo00000000002` | `lay-k` | `kenneth.lay@enron.com` |
| `demo-jeff-skilling` | `usr_enrondemo00000000003` | `skilling-j` | `jeff.skilling@enron.com` |

Source of truth: [`eval/fixtures/enron-demo-registry.json`](../fixtures/enron-demo-registry.json). Seed: **`npm run brain:seed-enron-demo`**.

---

## Default eval brain vs other personas

- **`npm run eval:run`** (JSONL Enron v1) defaults **`BRAIN_HOME`** to **Kean’s** tree (`usr_enrondemo00000000001`) when unset.
- **Lay** and **Skilling** cases require an explicit **`BRAIN_HOME`** (or future per-task override)—their mail is **not** in Kean’s index.

---

## Cross-persona facts (safe generalities)

- **Same company, same era:** **Enron** leadership / energy / trading / governance themes; **specific threads** differ by persona (see persona briefs).
- **Late-2001 weighting:** Many threads cluster **November–December 2001**; combine with **2002-01-01** “today” for “just happened” phrasing.
- **Message identifiers:** Tool results often expose stable **`…JavaMail.evans@thyme`** (or similar)—common **`toolResultIncludes`** anchors in JSONL.
- **User prompts:** Vague, product-shaped, **no tool names** (see [`eval/tasks/enron-v1.jsonl`](../tasks/enron-v1.jsonl)).

---

## Operational rules for eval authors

1. **Absolute dates** in user messages when possible; when using **relative** language, assume **eval clock** / demo **2002-01-01** unless `EVAL_ASSISTANT_NOW` overrides.
2. **Verify on seed:** **Message ids** and **substrings** against **`ripmail search`** / in-app search on a **fresh** `./data` seed—**not** against unverified brief prose.
3. **Wiki:** Follow [Wiki state and eval assertions](#wiki-state-and-eval-assertions)—never require pre-existing pages from a persona brief.
4. **Shared `./data`:** Interactive dev and evals can race on the same tenant dir—see [`eval/README.md`](../README.md) (`dev:eval:clean`, re-seed).
5. **No raw mail in git** — corpus in tarball + ignored tenant trees.

---

## Related docs

- [Eval harness README](../README.md)  
- [Eval home and mail corpus](../../docs/architecture/eval-home-and-mail-corpus.md)  
- [Enron eval suite architecture](../../docs/architecture/enron-eval-suite.md)  
- [Enron demo tenant (auth / hosted flows)](../../docs/architecture/enron-demo-tenant.md)
