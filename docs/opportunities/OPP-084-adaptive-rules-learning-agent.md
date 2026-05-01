# OPP-084 — Adaptive Rules: Async Learning Agent for Deterministic Inbox Rules

**Former ripmail id:** OPP-047 (unified backlog 2026-05-01).

**Status:** Active  
**Created:** 2026-04-10

---

## Problem

Inbox rules (`rules.json`) are written once and never updated. They drift: a rule like `from:github.com → notify` that made sense six months ago now fires on 50 emails a week, 47 of which go unread. There is no feedback loop — ripmail does not know which rules are pulling their weight and which are generating noise.

The LLM-based inbox era (OPP-032) solved classification quality by calling an LLM per-message. OPP-037/038 correctly moved back to deterministic rules for speed. But this left rules **static and hand-maintained**, with no mechanism to improve them from usage.

---

## Goal

Keep the fast path completely intact — inbox refresh never calls an LLM — while running an async learning agent in the background that observes usage signals, identifies weak rules, and proposes tighter search queries to replace them. The agent writes improved rules to `rules.json`; the next `ripmail inbox` picks them up automatically.

---

## Architecture: Two Paths

```
┌─────────────────────────────────────────────────┐
│  FAST PATH  (unchanged)                         │
│                                                 │
│  rules.json → DeterministicInboxClassifier      │
│  → SQLite FTS match → action                    │
│  No LLM. No network. Milliseconds.              │
└─────────────────────────────────────────────────┘
          ↓ logs every classification decision
┌─────────────────────────────────────────────────┐
│  SIGNAL STORE  (new SQLite tables)              │
│                                                 │
│  inbox_classifications: message_id, rule_id,    │
│    action, classified_at                        │
│  inbox_signals: message_id, event, occurred_at  │
│    events: read, replied, searched, archived    │
└─────────────────────────────────────────────────┘
          ↓ async, runs offline
┌─────────────────────────────────────────────────┐
│  LEARNING AGENT  (new, LLM-backed)              │
│                                                 │
│  1. Compute per-rule precision from signals     │
│  2. Identify rules below threshold              │
│  3. Call LLM with sample of matched messages    │
│  4. Validate proposed query against SQLite      │
│  5. Write updated rules.json                    │
└─────────────────────────────────────────────────┘
```

The LLM never touches the hot path. It only runs async to improve rules offline — once per day, on a handful of weak rules, with small context.

---

## Signal Collection

Engagement signals are already implicit in ripmail's CLI behavior — they just need to be logged:

| Event | Signal | Source |
|---|---|---|
| `ripmail read <id>` | Positive — message worth reading | CLI command |
| `ripmail thread <id>` | Positive — user followed up | CLI command |
| Agent calls `ripmail search` and retrieves an `ignored` message | Negative — something was missed | Search log |
| `notify` message never read within N days | Negative — false alarm | Time decay |
| `ripmail archive` called on a `notify` | Negative — over-surfaced | Archive command |
| `ripmail send` reply on a thread | Strong positive | Send command |

No UI instrumentation needed. All signals are observable from CLI invocations that already happen.

---

## Per-Rule Precision

The simplest useful metric before any LLM involvement:

```
precision(rule) = engaged_messages / classified_messages
```

Where `engaged_messages` is the count matched by this rule that later received a positive signal, and `classified_messages` is the total matched.

A rule with precision < 0.15 (15% of surfaced messages ever acted on) is a candidate for tightening. This is computable in pure SQL — no LLM needed.

`ripmail rules stats` exposes this as a new subcommand:

```
$ ripmail rules stats
rule              action   matched  engaged  precision
github-notify     notify      210       11      5.2%  ← weak
zoom-meetings     inform       34       28     82.4%
newsletter-ignore ignore      180        0      N/A   (ignore rules not scored)
```

---

## Learning Agent: What It Does

`ripmail rules learn` (or triggered automatically after sync):

1. **SELECT weak rules** — precision below threshold, minimum N classifications to be statistically meaningful
2. **Pull a sample** — up to 20 matched message snippets (from, subject, 200-char body) split between engaged and not-engaged
3. **Call LLM** — prompt: "This rule (`from:github.com notify`) matched 200 emails; only 11 were read. Here are examples of the 11 that were read and 9 that weren't. Suggest a tighter query that captures the read ones but not the noise."
4. **Validate** — run proposed query against SQLite; confirm it still matches the positive examples; reject if recall drops below 80%
5. **Write** — update `rules.json` with tightened query; log the change with before/after stats

The LLM call is cheap: small context, no streaming needed, runs once per weak rule per day at most.

---

## New Rules Subcommands

| Command | Description |
|---|---|
| `ripmail rules stats` | Per-rule precision table (no LLM) |
| `ripmail rules learn` | Run the async learning agent now |
| `ripmail rules learn --dry-run` | Show proposed changes without writing |
| `ripmail rules learn --rule <id>` | Target one specific rule |

The learning agent can also be triggered automatically as a post-step after `ripmail sync`, adding minimal overhead since it runs async.

---

## New SQLite Tables

```sql
-- One row per classification decision
CREATE TABLE inbox_classifications (
    message_id      TEXT NOT NULL,
    rule_id         TEXT,          -- NULL = fallback (no rule matched)
    action          TEXT NOT NULL,
    classified_at   TEXT NOT NULL  -- ISO 8601
);

-- Engagement events
CREATE TABLE inbox_signals (
    message_id      TEXT NOT NULL,
    event           TEXT NOT NULL, -- 'read' | 'replied' | 'archived' | 'searched'
    occurred_at     TEXT NOT NULL
);
```

Both tables are append-only. Precision is computed by joining them on `message_id` grouped by `rule_id`.

---

## Learning Agent Prompt Shape

```
You are improving inbox filter rules for a local email tool.

Rule: id="github-notify", action="notify", query="from:github.com"
Precision: 5.2% (11 of 210 matched emails were read)

ENGAGED (read or replied):
- from: notifications@github.com | subject: "[myrepo] Review requested"
- from: notifications@github.com | subject: "[myrepo] You were mentioned"
...

NOT ENGAGED (classified as notify, never opened):
- from: notifications@github.com | subject: "[someorg/repo] New release v2.3.1"
- from: notifications@github.com | subject: "[workflow] CI passed"
...

Suggest a tighter search query (same ripmail query syntax: from:, subject:, free text, OR/AND)
that captures the ENGAGED examples but excludes the NOT ENGAGED ones.
Reply with JSON: { "query": "...", "rationale": "..." }
```

---

## What Stays Unchanged

- `rules.json` remains the source of truth — human-readable, editable, versionable in git
- `DeterministicInboxClassifier` and `compute_deterministic_picks` are untouched
- Rules are still search queries; the learning agent only improves the query strings
- The learning agent never auto-applies changes without the user being able to review (`--dry-run` is always safe; auto-apply is opt-in)

---

## Phased Rollout

**Phase 1 — Signal collection (pure Rust, no LLM)**
- Add `inbox_classifications` and `inbox_signals` tables
- Log classification decisions at triage time
- Log read/archive signals at CLI invocation time
- Ship `ripmail rules stats`

**Phase 2 — Precision reporting (no LLM)**
- Compute and surface per-rule precision in `ripmail rules stats`
- Surface low-precision rules in `ripmail inbox` output as a hint

**Phase 3 — Learning agent (LLM)**
- Ship `ripmail rules learn --dry-run`
- Manual invocation only; no auto-apply
- Validate proposed queries against SQLite before surfacing

**Phase 4 — Auto-apply (opt-in)**
- `ripmail rules learn --auto` in config or flag
- Post-sync trigger; changes logged to `rules_learn.log` in `RIPMAIL_HOME`

---

## Affected Files

| File | Change |
|---|---|
| `src/db/schema.rs` | Add `inbox_classifications`, `inbox_signals` tables |
| `src/inbox/rule_match.rs` | Log classification decisions after each triage run |
| `src/cli/commands/mail.rs` (read) | Log `read` signal on `ripmail read` |
| `src/mailbox/archive.rs` | Log `archived` signal on `ripmail archive` |
| `src/cli/commands/rules.rs` | Add `stats` and `learn` subcommands |
| `src/rules.rs` | Add precision query helpers |
| New: `src/rules/learn.rs` | Learning agent: sample, prompt, validate, write |

---

## Out of Scope for v1

- Suggesting entirely new rules (only tightening existing ones)
- Learning from negative feedback explicitly provided by the user ("this was wrong")
- Merging or splitting rules (only query refinement)
- Rules for actions other than `notify` / `inform` (ignore precision is not meaningful — by definition nothing is engaged)
