# BUG-050: Agent wiki reads fail with ENOENT while composing mail (travel / trip context)

**Status:** Open  
**Tags:** `wiki` · `agent` · `mail` · `compose`  

**Related:** [BUG-043 archived](archive/BUG-043-read-file-at-mention-wiki-path-enoent.md) (**fixed 2026-05-05** — `me/` vs tools cwd). If this report **post-dates** that fix, either the deployment was stale, the model used **wrong paths**, or there is a **remaining** normalization gap — confirm with logs and the exact paths passed to read tools.

---

## Summary

During a **draft-mail** flow grounded in **travel / trip** planning, reads of wiki pages that should back date or trip context failed with **ENOENT**. The assistant had not established wiki evidence before suggesting timing; after the user asked for wiki-backed trips, reads still failed. **Same session** as in-app feedback **#16** (see [BUG-028 archived](archive/BUG-028-agent-email-draft-wrong-recipient-and-signature.md) for wrong **CC** / guessed contact email).

---

## Repro (from feedback)

1. Ask the assistant to draft mail and to use **May/June travel** from the wiki.
2. Observe mail/calendar tools used before wiki is searched.
3. Ask the assistant to search **trips in the wiki**.
4. Observe **ENOENT** on reads for the expected travel pages.
5. Continue drafting — assistant may **guess** contact fields (see **BUG-028** archived spec).

---

## Expected

- Read tools resolve the same paths as the **viewer** and **`wikis/me/…`** layout (**BUG-043** semantics).
- Assistant **prefers** wiki/contact evidence before guessing **To/CC** ([BUG-028 archived](archive/BUG-028-agent-email-draft-wrong-recipient-and-signature.md)).

---

## User feedback

- In-app issue **#16** (`2026-05-09`) — wiki read failures (**ENOENT**) in travel context during compose.
