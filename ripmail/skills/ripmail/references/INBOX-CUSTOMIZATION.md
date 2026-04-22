# Inbox customization and durable rules

This companion to [`../SKILL.md`](../SKILL.md) explains how to make **`ripmail inbox`** align with what matters to the mailbox owner using **one mechanism**: **`~/.ripmail/rules.json` version 3** with **`kind: "search"`** rules only.

**What inbox does:** Each rule is a **`query` string** with the **same grammar and SQL semantics as `ripmail search`** (see `src/search/query_parse.rs`, `src/search/filter.rs`, FTS5). Rules are applied in **file order** with **short-circuit**: only messages still in **`pending`** rule-triage state are eligible for the next rule; the first matching rule **assigns** an action and records **`winningRuleId`**. There is **no LLM** in the inbox path. **`RIPMAIL_OPENAI_API_KEY`** is **not** required for **`ripmail inbox`**. OpenAI is used elsewhere (**`ripmail ask`**, **`draft edit`**, setup/wizard), not for triage.

**What inbox does not use:** There is **no** separate “context” or free-text layer for matching. A legacy **`context`** array in `rules.json` may be **round-tripped** on save but is **ignored** by the classifier — do not rely on it; encode preferences as **search rules** instead.

**Bundled defaults:** On first run, ripmail installs **`default_rules.v3.json`** (same **`search`** shape as user rules): OTP-style FTS queries, **`category:`** filters for provider labels, noreply-style **`from:`** prefixes, marketing phrases, etc. Edit or extend with **`ripmail rules ...`** or by editing **`rules.json`** and running **`ripmail rules validate`** (use **`--sample`** to run counts against your open index).

**Cadence:** Run **`ripmail refresh`** so the local index stays current. Run **`ripmail inbox`** over the **already-indexed** window; run **`refresh`** first when **recency** matters. After you **change `rules.json`**, run **`ripmail inbox --reapply`** (optionally with a wider window, e.g. **`ripmail inbox 30d --reapply`**) so the **current** ruleset re-classifies mail already in SQLite and updates **`inbox_decisions`** / local archive flags for that window — same scan depth as **`--thorough`**, clearer name for agents. JSON output includes **`notify` / `inform` / `ignore`**, **`decisionSource`** (**`rule`** vs **`fallback`**), **`matchedRuleIds`**, optional **`winningRuleId`**, optional **`hints`**, and (for forward compatibility) **`requiresUserAction`**, **`actionSummary`**, **`counts.actionRequired`**. In current deterministic inbox, **`requiresUserAction`** stays **false** and **`actionSummary`** empty unless a future release defines them. Use **`ripmail inbox --diagnostics`** or **`--thorough`** when you need full rows or a complete rescan. Use **`ripmail archive`** when mail no longer needs focused attention; **`search` / `read` / `ask`** still see archived mail. Table: [Inbox workflow](../SKILL.md#inbox-workflow) in **`SKILL.md`**.

The core idea: **prototype with `ripmail search`**, then paste the working string into **`rules.json`** so preferences stay explicit and auditable.

---

## Version check first

Treat the installed **`ripmail`** binary as the source of truth:

1. Run **`ripmail inbox --help`** and **`ripmail rules --help`** to see supported flags in this version.
2. Prefer **`ripmail rules validate`**, **`ripmail rules add`**, **`ripmail rules edit`**, **`ripmail rules remove`**, **`ripmail rules move`** over hand-editing when possible.
3. Keep **`~/.ripmail/rules.json`** small, explicit, and auditable — every rule is **`kind: "search"`** with a non-empty **`query`**.

---

## Mental model

| Piece | Role |
| ----- | ---- |
| **Search rules** (`rules.json`) | The way to express **what should match** and **notify / inform / ignore**. Each rule has **`query`** (same language as **`ripmail search`**) plus **`action`**. Rules are an **ordered list**: **earlier rules take precedence** — the first rule whose query matches a message still in **`pending`** triage **wins**; lower rules do not reassign it. **`matchedRuleIds`** / **`winningRuleId`** reflect that winner. |
| **Sync category** | Metadata from the provider/sync pipeline (e.g. list, promotional). Reference it in a query with **`category:list`**, **`category:promotional`**, etc. |
| **No rule match** | **`decisionSource: "fallback"`** — ripmail still assigns an action so output is complete. This path is **deterministic and not LLM-based**; for predictable behavior on specific mail, **add a search rule** (or adjust bundled defaults). |
| **JSON compatibility fields** | **`requiresUserAction`**, **`actionSummary`** — reserved; current deterministic inbox does not populate them from triage. |

Think of **`rules.json`** as **mailbox memory** you control: add a rule when the same class of mail should always be **notify**, **inform**, or **ignore**.

---

## File shape

Keep customization in **`~/.ripmail/rules.json`** so it survives DB rebuilds and can be maintained by a human or an agent.

**Version 3** — rules are **`kind: "search"`** only:

```json
{
  "version": 3,
  "rules": [
    {
      "kind": "search",
      "id": "bank-mail",
      "action": "notify",
      "query": "from:alerts@mybank.example",
      "description": "Bank notifications"
    },
    {
      "kind": "search",
      "id": "invoices",
      "action": "inform",
      "query": "subject:invoice OR subject:payment due"
    },
    {
      "kind": "search",
      "id": "noreply",
      "action": "ignore",
      "query": "from:no-reply",
      "description": "Noreply-style From (example)"
    }
  ]
}
```

Do **not** add a **`context`** block for inbox behavior — it is not consulted for matching.

Run **`ripmail rules validate`** after edits. **`ripmail rules validate --sample`** runs compile checks plus **`COUNT`**-style samples against **`data/ripmail.db`** when available. Legacy **version 1** files, corrupt JSON, **`kind: regex`**, or invalid queries are rejected; the CLI may suggest **`ripmail rules reset-defaults --yes`** (renames the current file to **`rules.json.bak.<uuid>`** and installs bundled v3 defaults).

**`ripmail rules add`** (and **`ripmail rules edit`**) require normal **`ripmail`** config and data: **`$RIPMAIL_HOME`** (default **`~/.ripmail`**) and its synced **`data/ripmail.db`**. Inbox preview uses that index. **`ripmail rules add`** requires **`--action`** and **`--query`**. New rules **append** to the end (lowest precedence) unless you pass **`--insert-before <rule-id>`**. Optional **`--description`**, **`--preview-window`**. See **`ripmail rules add --help`**.

**`ripmail rules move <rule-id> --before <other-id>`** or **`--after <other-id>`** reorders an existing rule. Output is a **compact full list** after the move. See **`ripmail rules move --help`**.

Keep each rule:

- **Short**
- **Concrete**
- **Stable**
- **Easy to delete later**

Prefer one focused **`query`** over a paragraph of prose.

---

## Actions

Rules map to **notify / inform / ignore**. **`requiresUserAction` / `actionSummary`** are **not** rule actions; current deterministic inbox does not set them from classification. For **OTP / magic-link** mail, **`notify`** rules (or bundled defaults) surface them; use **`search` + `read`** when the user asks for a code.

| Action | Use when | Typical effect |
| ------ | -------- | -------------- |
| **`notify`** | Missing this right now would be costly | High-attention in **`inbox`** output and briefings |
| **`inform`** | Worth mentioning, not interrupting for | Listed in **`inbox`** output |
| **`ignore`** | Routine noise or mail you do not want in proactive triage | Classifier deprioritizes surfacing. **Local auto-archive** may apply when **`ignore`** came from a **matched rule** (including bundled defaults) or from **fixed signals** (excluded provider category, strict noreply-style sender, **unsubscribe** in subject or short preview, mail from your own address) — mail remains **searchable**. **Fallback** bulk heuristics avoid treating a bare **unsubscribe** word in the short preview alone as list mail. Use **`ripmail archive`** for **notify** / **inform** mail once handled |

Legacy CLI strings **`archive`** and **`suppress`** are accepted when adding rules and map to **`ignore`**.

---

## Writing good rules

Rules are **search queries**: see **`ripmail search --help`** and bundled **`src/rules/default_rules.v3.json`** in the repo.

Good:

- **`category:`** for routing from sync metadata without scanning the whole body
- **`from:`** / **`to:`** for addresses (prototype with **`ripmail search 'from:…'`**)
- **`subject:`**, date filters (**`after:`** / **`before:`**), and FTS terms with **`OR`** / **`AND`**
- **`from:a OR to:b`** form for header disjunction (see search parser tests)

Avoid:

- Overly broad queries that false-positive on personal mail
- Duplicating bundled defaults unless you need a different **`action`** or **order**
- One giant query that mixes unrelated ideas — prefer several rules and use **array order** (or **`--insert-before`**) so specific rules run before broad ones

**Category scope:** Rule evaluation aligns **`ripmail inbox`** candidate scope (including default category filtering vs **`--include-all` / `--thorough`**) with search options — not “bare search with no flags” when those differ. Use **`category:`** inside the **`query`** when you need an explicit category filter.

Encode “facts” as **queries**, not prose: e.g. property manager → **`from:their@address`**. Use **`ripmail who`** to discover exact addresses.

---

## Agent workflow

Use a small write loop instead of ad hoc memory:

1. Run **`refresh`** (when needed) then **`search`** to find a working expression.
2. Notice repeated user preferences or misfires.
3. Propose a **search rule** (or edit **order** / **action** / **`query`** in **`rules.json`**).
4. Get confirmation before changing **`rules.json`**.
5. Apply with **`ripmail rules add`** / **`edit`** / hand-edit + **`validate`**.
6. Re-run **`inbox`** to confirm.

Example prompts to the user:

- “You keep ignoring LinkedIn digests. Add **`--query 'from:linkedin'`** with **`ignore`**?”
- “Security mail should always surface — extend **`notify`** queries for your bank domain?”

Only add rules when the pattern is **repeated**, **clear**, and **likely to stay true**. Do not overfit on a single message.

**`ripmail rules feedback "<phrase>"`** prints **keyword-based suggestions** (not an LLM); use it as a hint, then write a real query with **`ripmail rules add`** or edit **`rules.json`**.

---

## Maintenance

Aim for a small ruleset that stays legible.

Add a rule when:

- The same class of mail keeps appearing when the user would rather **ignore** or archive it
- The user states a stable preference
- A recurring workflow needs explicit **notify** / **inform** / **ignore**

Edit or remove a rule when:

- Circumstances change
- A rule is too broad or too narrow
- The user wants different surfacing behavior

---

## Diagnostics and trust

When diagnostics are available, use them to answer:

- Why was this message surfaced?
- Which rule matched (**`matchedRuleIds`**, **`winningRuleId`**)?
- Was the decision **`rule`** or **`fallback`**?
- What **sync category** did indexing store (for **`category:`** in queries)?

**`counts.actionRequired`** may stay **0**; do not rely on it for triage todos until a future release defines those fields.

If the result surprises the user:

1. Inspect the **rule** that matched, or the **`fallback`** note when no rule matched
2. Tighten, broaden, or remove the **`query`**
3. Rerun **`ripmail inbox --reapply`** (or **`ripmail inbox --thorough`** — same scan) to re-triage indexed mail in the window

Personalization is only trustworthy if the user can understand and edit it.

---

## Patterns worth encoding

Common **search** families:

- **Important people**: partner, family, boss, key client — **`from:`** / **`to:`**
- **Security**: bank alerts, password resets, MFA — keywords + sender queries (bundled defaults cover many OTP-style phrases)
- **Noise**: marketing, social, lists — **`category:`** and/or **`from:`**
- **Routine transactional**: shipping, confirmations — specific **`from:`** or **`subject:`** queries with **`inform`** or **`ignore`**
- **Non-urgent but relevant**: project names, travel — FTS terms with **`inform`** or **`notify`**

---

## Safety rules for agents

- Prefer **small edits** to the ruleset, not rewrites.
- Keep user wording recognizable in **`description`** when helpful.
- Ask before adding, removing, or broadening a rule.
- Do not silently create a durable preference from one ambiguous action.
- Keep the file auditable by humans.

The goal is not a “perfect” inbox — it is an inbox that **stays aligned** with explicit, editable **search** rules.
