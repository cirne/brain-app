# Persona brief: Steven Kean (`demo-steve-kean`)

**Demo handle:** `demo-steve-kean`  
**Default eval tenant:** `./data/usr_enrondemo00000000001/` (mailbox `kean-s`; same tree as `npm run eval:run` when `BRAIN_HOME` is unset).

**Purpose:** Inform **JSONL / eval authoring** for runs grounded in **this** mail corpus. This is **not** a list of assets you can assert on in `expect`—lock expectations to **message ids**, **tool traces**, and **substrings verified** on a seeded index (see [enron-shared.md](./enron-shared.md)).

**Corpus-wide:** [enron-shared.md](./enron-shared.md) — mail through **2001-12-31**; authoritative assistant **today** **2002-01-01** for Enron demo + default eval clock.

**Wiki:** Evals **must not** assume any **pre-existing wiki** files, titles, or paths. If a case needs wiki content, the harness or the **same** agent turn must **create** it (e.g. explicit `write`/`edit` in the task) **before** expectations reference paths—see [enron-shared.md](./enron-shared.md#wiki-state-and-eval-assertions).

**Source:** Mail-grounded summary from a Braintunnel session imitating Steven Kean. Names and themes below are **hints for prompts and search**, not guaranteed wiki or file handles.

---

## Identity

| Field | Value |
|--------|--------|
| Name | Steven Kean (mail often **Steven J. Kean**) |
| Primary email | `steven.kean@enron.com` |
| Login ID | `skean` |
| Extension | 3-1586 |
| Office | EB 4712C |
| Signature / headers | **Steven J. Kean / NA / Enron** — useful substring for search / disambiguation |

---

## Role and focus

The mail trail supports a **senior Enron executive** in **energy/policy-related communications** and **internal approvals**.

- **Mid-2001:** Still **operational**—e.g. routing **PR2 access** and similar approvals.
- **Late December 2001:** Skews **closure-oriented**: goodbyes, lunch invites, relationship maintenance—not open project handoffs.

---

## What stands out in the evidence

1. **Mid-2001 was still operational.** Example class: **July 2001**—**PR2 access** for a **payroll/accounting** function that moved from Payroll to **Karen and Deana’s** group; request described transition **Jan. 1** and **blocked** net-pay reconciliation.
2. **Late 2001 was closure.** Strongest signals: **farewell**, **keep-in-touch**—not new assignments.
3. **Transition-era nuance.** **Social closure** ≠ **operational ownership**. Late-December notes default to **goodbye** unless they **explicitly** reopen work.
4. **Headers/signatures** help retrieval (**Steven J. Kean / NA / Enron**).

---

## Contacts and names (mail evidence)

Correspondents that show up around closure and operations—use **search** to anchor `expect`, not assumed filenames:

| Name | Role in capture |
|------|------------------|
| **Karen Denne** | Coworker; **lunch** / social touch in last days—**closure** lane |
| **Vicki Sharp** | **Goodbye**, keep in touch |
| **Bill Frasier** | Coworker/friend; **relationship maintenance**, not active work ownership |
| **Karen and Deana** (group) | Named in **PR2 / payroll** routing story (mid-2001) |

---

## Patterns in the mail

### Operational phase

- **July 2001:** **Approvals** and **policy-related** threads.
- **PR2 / payroll** after move to **Karen and Deana’s** group → transition still includes **operational** decisions.

### Closure phase

- **December 2001:** **Farewell** / **relationship maintenance**.
- Examples from capture: **Karen Denne** (lunch); **Vicki Sharp** (goodbye); **Bill Frasier** (closure lane).

---

## Practical rules

**Agents (persona-consistent behavior)**

1. **Late Dec 2001 + goodbye tone** → **closure**, not a new work queue.
2. **Mid-2001 + approvals / routing** → **active work**.
3. **Nostalgia/warmth** ≠ implicit **new assignment**.
4. **When in doubt, read the date first.**

**Eval authors**

1. Prefer **absolute date ranges** in user messages.
2. Anchor `expect` to **message ids** and **tool result substrings** from **`ripmail search`** / product search on a **fresh seed**.
3. **Year-end closure** cases vs **mid-2001 ops** cases: don’t expect operational project outcomes from purely goodbye-style prompts (and vice versa).
4. **Never** assert that a wiki path or page **already exists** unless this eval (or setup) **created** it.

---

## Durable takeaways

- **Arc:** **Operational** in **mid-2001** → **farewell/cleanup** by **year-end 2001**.
- **Theme:** **Handoff/work** vs **relationship maintenance**—don’t conflate them in scenarios or scoring.
- This file informs **who/when/what to search for**; it does not define on-disk wiki layout.

---

## Related docs

- [Eval harness README](../README.md)  
- [Shared Enron fixture context](./enron-shared.md)  
- [Persona brief: Kenneth Lay](./persona-demo-ken-lay.md)  
- [Persona brief: Jeff Skilling](./persona-demo-jeff-skilling.md)  
- [Enron eval suite architecture](../../docs/architecture/enron-eval-suite.md)  
- [Eval home and mail corpus](../../docs/architecture/eval-home-and-mail-corpus.md)
