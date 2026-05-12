# Persona brief: Kenneth Lay (`demo-ken-lay`)

**Demo handle:** `demo-ken-lay`  
**Eval / dev tenant:** `./data/usr_enrondemo00000000002/` (fixture mailbox `lay-k` → ripmail id `lay_eval_enron_fixture`; see [`enron-lay-manifest.json`](../fixtures/enron-lay-manifest.json)).  
**Note:** Default `npm run eval:run` uses **Kean’s** `BRAIN_HOME` unless you override—Lay-specific JSONL suites or cases must set **`BRAIN_HOME`** (or a future per-task tenant field) to this tree.

**Purpose:** Inform **eval authoring** for runs grounded in **Lay’s mail**. Lock `expect` clauses to **verified** mail artifacts, not to this prose alone.

**Corpus-wide:** [enron-shared.md](./enron-shared.md) — mail through **2001-12-31**; assistant **today** **2002-01-01** for Enron demo + default eval clock.

**Wiki:** Evals **must not** assume **pre-existing wiki** pages or paths. If wiki output matters, the case must **create** that state in-flow or via harness setup—see [enron-shared.md](./enron-shared.md#wiki-state-and-eval-assertions).

**Source:** Mail-grounded summary from a Braintunnel session (Kenneth Lay context). Names and themes are **search hints** only.

---

## Identity

| Field | Value |
|--------|--------|
| Name | **Kenneth L. Lay** |
| Primary email | `kenneth.lay@enron.com` |
| Archive maildir (fixture) | `lay-k` |

---

## Role and focus

**Leadership / executive-level** mailbox: **executive correspondence**, **committee** material, **external relations**, **sponsorship / speaking / event** mail, **major company issues**.

**Recurring focus (from mail patterns)**

- **Leadership and governance** — executive committee, board-related, company-wide policy and culture.
- **India / Dabhol** — proposed **sale or reorganization** of Enron’s **India** assets, **Dabhol** in particular; treat as a **sustained** thread, not a one-off mention.
- **Energy assets / portfolio** — asset sale, value-maximization.
- **External visibility / networking** — speaking, newsletters, **e-lert**-style outreach.
- **Family / personal** — some **family** traffic (e.g. **Holly Lay**, **layfam**-style addresses); scope **evals** to what **search actually returns**.

---

## Contacts and names (mail evidence)

| Name | Notes |
|------|--------|
| **Pravas Sud** | **India / Dabhol** angle; capture describes briefing help for **Ben Glisan** and India asset sale as **live**. |
| **Michael McCann** | External **networking / promotional**; **recurring e-lert** / newsletter-style mail. |
| **Ben Glisan** | Named as briefing audience in **India asset** threads. |
| **Holly Lay** / **layfam** | Personal / family addressing—use only with **mail-backed** asserts. |
| **Executive / committee** | Governance and company-wide mail **alongside** outreach—not only “strategy” threads. |

---

## Durable themes (prompts and scoring—not file names)

1. **India / Dabhol** — real **project** thread: sale of India assets, internal **India expertise** / briefing needs.
2. **Strategic + operational** — committee material coexists with **sponsorship**, **speaking**, public-facing volume.
3. **Outreach target** — external mail assumes a **recognizable executive**; high volume ≠ all “core strategy.”
4. **Late-2001 weighting** — strong cluster **November–December 2001**; use **absolute dates** in tasks.

---

## Evidence windows (verify before `expect`)

Authoring hints only—attach **message ids** from search when you codify JSONL.

| Window | Pattern (from capture) |
|--------|-------------------------|
| **2001-12-28** | **Pravas Sud** — India assets sale; briefing for **Ben Glisan**. |
| **2001-11-29** | **Pravas Sud** — leadership, **recovery** after turmoil. |
| **2001-11 – 2001-12** | **Michael McCann** — recurring **e-lert** / newsletter. |
| **2001-08** | **Executive committee** traffic. |
| **2001-09** | **Media**, **values**, **harassment prevention**—company-level leadership themes. |

---

## Verified vs inferred (eval design)

**Strong bases for mail-backed asserts** (still **re-verify** per seed)

- Identity **Kenneth Lay** / **`kenneth.lay@enron.com`**.
- Recurrent **India / Dabhol** and asset narratives.
- **Executive committee** and leadership correspondence.
- **External networking / e-lert** mail.

**Weak alone as automated `expect`**

- Broad “senior leadership” or “strategic importance” **wording** without **retrieved** snippets or ids.

Prefer **`toolResultIncludes`**, **message ids**, **dated senders**.

---

## Practical rules

**Reading Lay’s mail**

1. **Late 2001** dense—calibrate “current” to roughly **2001-08 … 2001-12** unless the user narrows it.
2. **India / Dabhol** / asset sale — on-theme for **priority / theme** questions.
3. Separate **committee / governance** from **newsletter / networking** volume.
4. **Personal / family** threads—don’t treat as work product without **dates and senders**.

**Eval authors**

1. Set **`BRAIN_HOME`** to **`./data/usr_enrondemo00000000002`** for Lay-only cases.
2. Anchor on **senders**, **subjects**, **Dabhol / India asset sale**, **Glisan**, **McCann**, **committee**—then **message ids**.
3. **Do not** require or assume **pre-existing wiki** content; same rule as [enron-shared.md](./enron-shared.md#wiki-state-and-eval-assertions).

---

## Related docs

- [Eval harness README](../README.md)  
- [Shared Enron fixture context](./enron-shared.md)  
- [Persona brief: Steven Kean](./persona-demo-steve-kean.md)  
- [Persona brief: Jeff Skilling](./persona-demo-jeff-skilling.md)  
- [Enron eval suite architecture](../../docs/architecture/enron-eval-suite.md)  
- [Eval home and mail corpus](../../docs/architecture/eval-home-and-mail-corpus.md)
