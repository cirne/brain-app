# BUG-042: Agent easily confused when search surfaces **shared** wiki docs without explicit provenance

**Status:** Fixed (provenance tags on find/grep + read banner + prompt; see `wikiToolProvenance.ts`)  
**Severity:** P2 (trust + correctness; user thinks assistant is answering from *their* vault)  
**Related:** [BUG-040](BUG-040-wiki-chat-overlay-shared-doc-open-fails.md), [OPP-091](../opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md) (unified namespace), [remediation plan](BUG-042-remediation-plan.md) (unified search + provenance)

---

## Symptoms

- Natural language like **“Find my travel plans for New York”** can return hits that live under a **collaborator / shared** projection, not the signed-in user’s personal vault.
- `**search_index` (or equivalent wiki search tool)** payloads **do not clearly label** hits as **shared / `@handle` / not owned by me**, or the distinction is easy for the **LLM to miss** in the tool JSON / text.
- The assistant may **summarize or reason** as if the document were the user’s own plan, **without disambiguation** (“this is from X’s wiki” vs “yours”).

---

## Expected

- Every search hit that is **not** unambiguously under `**me/`** (or the user’s default vault) exposes **machine-stable + human-readable provenance** in the tool result: e.g. **owner/handle**, **shared vs personal**, and a **canonical path** matching overlay + `read_file` resolution.
- System prompt or tool docs (where appropriate) **instruct** the model to **state source** when answering from shared material.

---

## Notes / direction

- Prefer **one field** (or naming convention) every model can rely on rather than inferring from path shape alone.
- Align with **unified path vocabulary** (`@handle/…`, `me/…`) so search, read, and UI agree.