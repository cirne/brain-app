# Archived: OPP-052 — Search query language redesign

**Status: Deprioritized — archived 2026-04-21.** Full grep/regex + metadata-flag redesign not scheduled; current `ripmail search` + brain `search_index` evolve incrementally.

---

# OPP-052 — Rethink ripmail search: grep-friendly pattern + metadata flags

**Historical status:** Future / design  
**Scope:** ripmail `search` **user contract** (CLI + agent JSON), filters, and brain-app `search_index`; implementation may still use SQLite FTS5 **under the hood** for tokenization or prefiltering, but **FTS5 must not appear in the interface**—no dual “keyword vs regex” modes, no FTS query syntax exposed to users or agents.

## Problem

Search today is built around **email-shaped** assumptions:

- A **single query string** mixes **FTS5 keyword** text with **inline operators** (`from:`, `to:`, `subject:`, `after:`, …) parsed in `[query_parse](../../src/search/query_parse.rs)`. That made sense when the index was mostly mail.
- **Unified sources** ([OPP-051](OPP-051-unified-sources-mail-local-files-future-connectors.md)) already put **mail and local files** in one index; the **language** still reads like “inbox search,” not “search everything we indexed.”
- **Power users and agents** want **grep-like** behavior: alternation, boundaries, literals—without fighting FTS5 token rules and escape layers (`escape_fts5_query`, special-character UX bugs).
- **Metadata** (time range, sender, recipient, source id, MIME/category) is **orthogonal** to “what text matched”; cramming it into the same string as full-text query is fragile and hard to document.

## Proposed direction (conceptual)

A deliberate **redesign**, not a patch:

1. **Separate “pattern” from “filters.”**
  - **Pattern:** one optional string—the **only** text-matching knob users see. It uses a **single** grep/IDE-friendly ruleset (regex or a documented safe subset), not a parallel “FTS query language.” **Alternation** is the everyday idiom: e.g. `beloved|gallery` (match either substring), not `beloved OR gallery` or FTS phrase rules.
  - **Filters:** **flags or structured fields** for metadata—e.g. `--from`, `--to`, `--after` / `--before`, `--source`, `--kind` (mail vs file), etc.—so agents and shell scripts do not rely on inline `from:` parsing inside a free-text blob.
2. **Case sensitivity (defaults + override).**
  - **Default: case-insensitive.** Matches how people search mail and notes: `gallery` finds `Gallery` without thinking about regex flags.
  - **Override:** e.g. `--case-sensitive` (long) so callers **never** need to embed `(?i)` or inline mode switches for the common case. Simple patterns like `beloved|gallery` “just work” for case; opt into strict case only when needed.
3. **Less email-specific vocabulary.**
  - Prefer **neutral** names where the same filter applies across mail and files: e.g. “author” / “origin” vs only `from:`; “time range” as first-class; **source** scoping aligned with [OPP-051](OPP-051-unified-sources-mail-local-files-future-connectors.md).
  - Keep **email**-specific aliases (`from:` / `to:`) only as **compatibility shims** during transition, or document a one-time breaking change per repo early-dev policy.
4. **Implementation (out of band for callers).**
  - Pattern search over large corpora can be slow unless scoped (filters: source, date window, path prefix). Options include prefilter + line scan, SQLite `REGEXP` / application-defined function, or a **RE2**-style subset for safety. Document **denial-of-service** and how the index is used **internally**—without leaking FTS concepts into CLI help or agent prompts.
5. **Agent/tool surfaces.**
  - Brain `[search_index](../../../src/server/agent/tools.ts)` and any future HTTP search API should take **structured parameters** (`pattern`, `caseSensitive` boolean, filter object)—not a string that mixes operators and body text.

## Dependencies

- **Unified sources** ([OPP-051](OPP-051-unified-sources-mail-local-files-future-connectors.md)) — search should be defined against the **same** index model (mail + files + future connectors).
- **Archive** [OPP-038](archive/OPP-038-inbox-rules-as-search-language.md) — historical “rules as search language” thinking; OPP-052 is **product-wide search UX**, not only inbox.

## Non-goals (for this note)

- Choosing exact SQL or internal indexing strategy here (FTS5 may remain an implementation detail).
- Committing to a particular regex engine (Rust `regex` vs RE2 vs SQLite extension) — that belongs in a design doc after spike.

## Brain-app impact

Agent tools and prompts that teach `search_index` + query strings will need **updates** when the new contract lands; cross-link from [docs/OPPORTUNITIES.md](../../../docs/OPPORTUNITIES.md) (repo root).