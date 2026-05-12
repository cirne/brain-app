# Persona brief: Jeff Skilling (`demo-jeff-skilling`)

**Demo handle:** `demo-jeff-skilling`  
**Eval / dev tenant:** `./data/usr_enrondemo00000000003/` (fixture mailbox `skilling-j` → ripmail id `skilling_eval_enron_fixture`; see [`enron-skilling-manifest.json`](../fixtures/enron-skilling-manifest.json)).  
**Note:** Default `npm run eval:run` uses **Kean’s** `BRAIN_HOME` unless you override—Skilling-specific cases need **`BRAIN_HOME`** (or a future per-task tenant) pointing here.

**Purpose:** Inform **eval authoring** for runs grounded in **Skilling’s mail**. Assertions belong in **verified** artifacts, not in assumed product wiki structure.

**Corpus-wide:** [enron-shared.md](./enron-shared.md) — mail through **2001-12-31**; assistant **today** **2002-01-01** for Enron demo + default eval clock.

**Wiki:** Evals **must not** assume **pre-existing wiki** pages. If wiki behavior is under test, **create** the files in the same flow or in harness setup—see [enron-shared.md](./enron-shared.md#wiki-state-and-eval-assertions).

**Source:** **Mail archive** plus limited **public** role context (CEO 2001, prior COO, McKinsey background). Use public facts for **persona-consistent prompts**; tie automated **`expect`** to **mail** (and tool traces) where possible.

---

## Identity

| Field | Value |
|--------|--------|
| Name | **Jeff Skilling** |
| Primary email | `jeff.skilling@enron.com` |
| Archive maildir (fixture) | `skilling-j` |

**Public context (prompts—not sole basis for `expect`):** In **2001**, Enron **president and CEO** (earlier **president and COO**); joined **1990**; prior **McKinsey**.

---

## Role and focus (mail)

**Senior executive** at the **center of leadership and operating decisions**: often writes **directly** to **large distribution lists**—tone of **coordinating leadership-level internal communications**, not deep hierarchy routing.

**Density:** Substantial **2001** mail, **spring and summer** cluster, plus ongoing leadership traffic.

**Observable patterns**

- **Company-wide invitations** and **executive events**
- **Replies** re concerns to the **Office of the Chairman** (reassurance that issues are handled)
- **Coordination** across a **very wide** internal network
- **Agenda** framed as **growth**, **online trading**, **new business creation**

---

## Standout examples (verify before hard asserts)

Hints only—add **message ids** from search when locking JSONL.

- **Harvard Business School / “Modern Giants”** — company-wide invite for **“New Business Creation”** tied to a **five-year HBS–Enron** partnership branded **“Modern Giants.”**
- **Office of the Chairman** — direct reassurance; capture names **Fernando Fernandez** as a sender Skilling **replies** to.
- **Online trading** — repeated references to Enron’s **online trading platform** and **scale-up** (same era as **EnronOnline** in public material).

---

## Core business themes

1. **EnronOnline / electronic trading** — web **commodity trading**; scale, speed, transparency narratives; adjacent commodity push.
2. **Wholesale energy / new markets** — trading **infrastructure**, **risk** products, **adjacent** markets; innovation, scale, execution language.
3. **Executive communication** — top-down alignment, **event** coordination, **large** distributions.

*(Theme labels are for **search and prompt design**, not for assuming any wiki page exists.)*

---

## Important contacts and collaborators (mail / public cross-check)

| Name | Relevance |
|------|-----------|
| **Kenneth Lay** | Chairman; leadership counterpart |
| **Christie Patrick** | Capture: logistics / **RSVP** around **“Please Plan to Attend”**-style invites |
| **Fernando Fernandez** | **Office of the Chairman** thread; Skilling **replies** |
| **Andrew Fastow** | On **executive** distributions—finance leadership overlap |
| **Louise Kitchen** | **Public** association with **EnronOnline** / online trading story |

---

## Recurring initiative labels (mail themes, not wiki paths)

Use as **keywords for search** and user prompts:

| Theme | Notes |
|-------|--------|
| **EnronOnline** | Strong **internet commodity trading** thread |
| **Modern Giants / HBS** | Thought leadership / **New Business Creation** event |
| **New business creation** | New businesses, scaling trading, **market structure + technology** |

---

## Working style (prompt design)

- **Highly connected**; **large-group** comfortable  
- **Executive** decisions and communications  
- **Market design**, **growth**, **innovation**  
- **Central node** in leadership—not a narrow specialist

---

## Practical rules

**Reading Skilling’s mail**

1. **2001-heavy**; **spring/summer** cluster—use [enron-shared.md](./enron-shared.md) for **“today” = 2002-01-01** vs “recent.”
2. **EnronOnline**, **online trading**, **Modern Giants** / **new business** language—on-theme.
3. **Office of the Chairman** — employee concern / reassurance lane; not every blast is “marketing only.”

**Eval authors**

1. **`BRAIN_HOME`** → **`./data/usr_enrondemo00000000003`** for Skilling-only tasks.
2. Contrast arcs vs **Lay** (India/Dabhol, e-lerts) vs **Kean** (PR2, year-end closure)—by **mail content**, not wiki.
3. **No pre-existing wiki assumptions.**

---

## Related docs

- [Shared Enron fixture context](./enron-shared.md)  
- [Eval harness README](../README.md)  
- [Persona brief: Steven Kean](./persona-demo-steve-kean.md)  
- [Persona brief: Kenneth Lay](./persona-demo-ken-lay.md)  
- [Enron eval suite architecture](../../docs/architecture/enron-eval-suite.md)  
- [Eval home and mail corpus](../../docs/architecture/eval-home-and-mail-corpus.md)
