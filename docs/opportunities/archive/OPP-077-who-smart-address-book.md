# Archived: OPP-077 — Contacts & `ripmail who` (smart address book)

**Status: Archived (2026-05-11).** **Done enough** for backlog tracking: hygiene, merged identities, `contactRank`, signatures, and heuristic naming are shipped in-tree; richer signature extraction and fancier `who` query polish remain incremental follow-ons if needed.


---

## Original spec (historical)

### OPP-077: Contacts & `ripmail who` — Smart Address Book

**Former ripmail id:** OPP-012 (unified backlog 2026-05-01).

**Problem:** Agents need one reliable way to answer “who is this?” and “how do I reach them?” from mail. That means **merged identities**, **honest interaction counts**, **sensible ordering**, and **structured fields** (phone, title, company, links) — without turning ripmail into Google Contacts.

**Direction:** Treat `ripmail who` as the **contact layer** on top of the indexed corpus: same data model for CLI, MCP `who`, and (indirectly) search / `ask` when retrieval uses `search()`.

---

## What’s shipped

| Area | Summary |
|------|---------|
| **Hygiene** | Case-insensitive addresses, noreply/bot handling, `lastContact`. |
| **Identity** | Merge by display name, `aka` aliases, basic domain/address lists. |
| **Name inference** | Heuristic names from local-part (`firstname.lastname`, etc.) when headers lack a name; optional `--enrich` for harder cases ([BUG-011](../../ripmail/docs/bugs/archive/BUG-011-who-dartmouth-not-merged.md)). |
| **Signatures** | Phone, title, company, social URLs, alt emails, quoted-reply cutoff ([BUG-014](../../ripmail/docs/bugs/archive/BUG-014-who-signature-parser-noise.md)). |
| **Owner-centric counts + `contactRank`** | `sentCount` / `repliedCount` / `receivedCount` / `mentionedCount` (CC exposure) with mailbox owner from config; **`people` sorted by `contactRank` descending**; search can apply a small participant boost. See Rust `src/search/contact_rank.rs`. |

---

## Ranking & interaction signals (core contract)

Counts are over indexed mail; **owner** = configured IMAP user. **`contactRank`** is a log-scaled score from those counts (ordering signal, not “importance”). **Fuzzy name/address match** filters candidates; **primary sort** among matches is **`contactRank`**, not best string match.

| Field | Meaning (owner-centric) |
|-------|-------------------------|
| `sentCount` | Your messages **to** them that **start** a thread (first outbound in that `thread_id`). |
| `repliedCount` | Your **further** outbound **to** them in threads you already started with them. |
| `receivedCount` | Messages **from** them **to** you. |
| `mentionedCount` | They appear in **Cc** (not sender) on messages in the corpus. |
| `lastContact` | Latest message date involving them. |

**Still validate:** Whether **search** tie-break boosts are worth tuning beyond the current small boost; whether **`refresh` / `inbox`** should use the same signal to protect mail from regular correspondents vs bulk (may combine with [OPP-021 archived](../../ripmail/docs/opportunities/archive/OPP-021-ask-spam-promo-awareness.md)).

---

## Deeper signature extraction (next)

Basics exist; **richer structure** is still open:

- Multiple phones with labels (mobile / office / fax), categorized URLs (LinkedIn, GitHub, …), department, location/timezone, pronouns — see implementation notes in `src/search/signature.ts` / `who-dynamic.ts`.

---

## Smarter `who` queries (later)

- `--full`, `--top`, `--recent`, `company:` filters, clustering — polish once ranking and fields stabilize.

---

## Non-goals

- Full external CRM sync as default; named groups (“family”) as a v1 requirement; LLM clustering of everyone in the mailbox. Optional external enrichment was explored ([archived OPP-014](../../ripmail/docs/opportunities/archive/OPP-014-who-external-enrichment-exploration.md)); signature + inference stay primary.

---

## References

- [VISION.md](../../ripmail/docs/VISION.md) — agent-first product
- [OPP-001 archived](../../ripmail/docs/opportunities/archive/OPP-001-personalization.md) — user aliases; complements structural boosts
- [OPP-019 archived](../../ripmail/docs/opportunities/archive/OPP-019-fts-first-retire-semantic-default.md) — FTS-first; ranking augments FTS, does not replace it
- **[OPP-004 archived](../../ripmail/docs/opportunities/archive/OPP-004-people-index-contacts.md)** — original people index
