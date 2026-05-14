# Archived: OPP-085 — Rule action extensions

**Status: Archived (2026-05-11).** Ripmail corpus backlog closed for tracking.


---

## Original spec (historical)

### OPP-085 — Rule Action Extensions: Forward, Draft-Reply, Auto-Reply

**Former ripmail id:** OPP-048 (unified backlog 2026-05-01).

**Status:** Active  
**Created:** 2026-04-10

---

## Problem

Inbox rules today support three actions: `notify`, `inform`, `ignore`. These control *how visible* a message is in the inbox surface. They do not *do anything* to the message.

Many useful inbox automation patterns require acting on mail — forwarding a receipt to a shared inbox, auto-acknowledging routine requests, drafting a reply based on a template. Today these require a user or agent to notice the message and compose a follow-up manually.

Rule actions that produce side-effects would let `rules.json` express real automation: "when this kind of email arrives, do this thing."

---

## Proposed New Action Types

### 1. `forward`

Forward the matched message to a specific address, then mark it handled.

**Rule shape:**

```json
{
  "kind": "search",
  "id": "receipts-to-finance",
  "action": "forward",
  "forwardTo": "finance@mycompany.com",
  "query": "subject:receipt OR subject:invoice from:stripe.com OR from:quickbooks.com",
  "description": "Forward all Stripe/QuickBooks receipts to the finance inbox"
}
```

**Behavior:**
- Sends a forward via SMTP (same plumbing as `ripmail send`)
- Subject: `Fwd: <original subject>`
- Body: original message quoted (same as `ripmail draft forward`)
- Marks the message as handled in inbox state; does not surface as `notify`
- Fires once per message (idempotent: checks `inbox_signals` for a prior `forwarded` event)

**Use cases:**
- Receipts → shared accounting inbox
- Security alerts → team alias
- Certain sender → assistant who handles scheduling

---

### 2. `draft-reply`

Compose a draft reply using the LLM, guided by a prompt fragment in the rule. The draft lands in `ripmail draft list` for the user to review and send. Does not auto-send.

**Rule shape:**

```json
{
  "kind": "search",
  "id": "meeting-request-draft",
  "action": "draft-reply",
  "replyPrompt": "Acknowledge the meeting request. Say I'll check my calendar and follow up by end of day. Keep it brief and friendly.",
  "query": "subject:meeting OR subject:call OR subject:sync from:@external-domain.com",
  "description": "Draft acknowledgement replies to inbound meeting requests"
}
```

**Behavior:**
- On match, calls the LLM with: original message + `replyPrompt` + user's voice context (from OPP-029 sent history if available)
- Saves the result as a draft via `ripmail draft` store
- Does NOT send
- Surfaces the message as `notify` with a hint: `draft ready · ripmail draft list`
- Fires once per message; subsequent `ripmail inbox` runs skip if draft already exists

**Use cases:**
- Acknowledge inbound requests while you're heads-down
- Draft a polite decline for solicitations
- Compose a "received, will review" reply to anything from a client domain

The `replyPrompt` is the RL hook: it acts like a per-rule system prompt that shapes the draft's content and tone. The learning agent (**OPP-084**) could eventually tune these prompts based on how often the user edits or discards the resulting drafts.

---

### 3. `auto-reply`

Like `draft-reply` but sends immediately without human review. The YOLO option. Requires explicit opt-in in config.

**Rule shape:**

```json
{
  "kind": "search",
  "id": "ooo-auto-reply",
  "action": "auto-reply",
  "replyPrompt": "I'm out of office until April 18. I'll respond when I'm back. For urgent matters, contact support@mycompany.com.",
  "query": "to:me@mycompany.com",
  "description": "OOO auto-reply to all direct inbound mail"
}
```

**Behavior:**
- Same as `draft-reply` but calls `ripmail send` on the resulting draft automatically
- Guards: will NOT reply to noreply/automated senders (detected via existing `is_noreply()` heuristic), mailing lists, or addresses it has already auto-replied to in the past N days (prevents loops)
- Requires `"allowAutoReply": true` in `config.json` as a global safety gate — without it, `auto-reply` rules behave as `draft-reply` with a warning
- Logs every auto-send to `~/.ripmail/auto_reply.log` with message ID, recipient, and timestamp

**Use cases:**
- Out-of-office replies
- Automated acknowledgement for support@ or info@ aliases piped through ripmail
- Recurring routine replies ("yes, confirmed" to known sender patterns)

---

## Schema Change: Single Action → Action Array

The current `UserRule::Search` has `action: String` — one flat categorization verb. Side-effect actions need parameters, and a single rule might want to do multiple things (e.g., categorize as `notify` AND forward to a shared inbox).

This is a rules schema version bump (`v3 → v4`). The `action` field becomes `actions: Vec<RuleAction>`, where each action is a tagged object:

**New `rules.json` v4 shape:**

```json
{
  "version": 4,
  "rules": [
    {
      "kind": "search",
      "id": "receipts-to-finance",
      "query": "subject:receipt OR subject:invoice from:stripe.com",
      "actions": [
        { "kind": "categorize", "category": "inform" },
        { "kind": "forward", "to": "finance@mycompany.com" }
      ]
    },
    {
      "kind": "search",
      "id": "meeting-requests",
      "query": "subject:meeting OR subject:call from:@external.com",
      "actions": [
        { "kind": "categorize", "category": "notify" },
        { "kind": "draft-reply", "prompt": "Acknowledge the meeting request. Say I'll check my calendar and follow up by end of day." }
      ]
    },
    {
      "kind": "search",
      "id": "github-prs",
      "query": "from:github.com review requested",
      "actions": [
        { "kind": "categorize", "category": "notify" }
      ]
    }
  ]
}
```

**Backward compatibility:** v3 rules with `action: "notify"` are **auto-migrated** on load to `actions: [{ "kind": "categorize", "category": "notify" }]`. The existing `action` field is kept in the v3 parser; the v4 parser expects `actions`. Migration is in-memory — no file rewrite unless the user saves explicitly.

**Rust structs:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RuleAction {
    #[serde(rename = "categorize")]
    Categorize { category: String },         // "notify" | "inform" | "ignore"

    #[serde(rename = "forward")]
    Forward { to: String },

    #[serde(rename = "draft-reply")]
    DraftReply { prompt: String },

    #[serde(rename = "auto-reply")]
    AutoReply { prompt: String },
}

// UserRule::Search gains `actions`, loses `action`:
pub enum UserRule {
    #[serde(rename = "search")]
    Search {
        id: String,
        query: String,
        actions: Vec<RuleAction>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
}
```

The `categorize` action replaces the old `action` string directly. All existing logic that checks `action_str()` is updated to find the `Categorize` entry in the actions list. If no `Categorize` action is present, the message is surfaced using fallback logic (same as today's no-rule-matched path).

---

## Execution Model

Side-effect actions do not run inside the fast `DeterministicInboxClassifier` triage path. They run in a separate **action execution pass** that happens after triage, asynchronously:

```
1. ripmail inbox (triage) — fast, deterministic, no LLM
   → identifies which messages matched side-effect rules

2. ripmail inbox (action pass) — async, after triage
   → for each pending side-effect: execute (forward / draft / send)
   → log to inbox_signals

3. ripmail inbox output — surfaces results including "draft ready" hints
```

This keeps the fast path fast. Side-effect rules are inherently async — they involve SMTP or LLM calls — so the separation is natural.

The action pass runs as part of `ripmail refresh` (which already orchestrates sync + inbox scan) and can be skipped with a flag for callers that only want triage output.

---

## Safety Design

| Risk | Mitigation |
|---|---|
| Auto-reply loops | `is_noreply()` check; per-address cooldown (N days) |
| Duplicate forwards | Idempotency via `inbox_signals` `forwarded` event |
| Duplicate drafts | Check draft store for existing draft on same thread before creating |
| Accidental `auto-reply` | Global `allowAutoReply: true` gate in config.json; absent = behave as `draft-reply` |
| Reply to mailing lists | Check `List-Unsubscribe` / `List-Id` headers before auto-replying |
| Reply to yourself | Skip if reply-to address matches any configured mailbox address |

---

## New `inbox_signals` Events (extends **OPP-084**)

| Event | Trigger |
|---|---|
| `forwarded` | `forward` action executed |
| `draft_created` | `draft-reply` action created a draft |
| `auto_replied` | `auto-reply` action sent a message |

These integrate directly with **OPP-084** signal store and precision tracking. A `draft-reply` rule where the user always discards the draft is low-quality; the learning agent can tighten its query or flag the prompt for revision.

---

## New Config Gate

```json
{
  "inbox": {
    "allowAutoReply": true
  }
}
```

Absent or `false`: `auto-reply` rules behave as `draft-reply` with a console warning. This must be set explicitly — there is no path to auto-sending without the user opting in.

---

## CLI Surface

No new top-level commands needed. Changes are:

- `ripmail inbox` output: action hints alongside matched messages (`"draft ready"`, `"forwarded to finance@..."`)
- `ripmail rules add` / `ripmail rules edit`: accept `--forward-to` and `--reply-prompt` flags
- `ripmail rules validate`: enforce that side-effect fields are present when required

---

## Affected Files

| File | Change |
|---|---|
| `src/rules.rs` | Add `forward_to`/`reply_prompt` fields to `UserRule::Search`; extend `RuleActionKind`; update `parse_rule_action` |
| `src/inbox/scan.rs` | Identify side-effect matches in triage output |
| New: `src/inbox/action_pass.rs` | Execute forward / draft-reply / auto-reply for pending matches |
| `src/config.rs` | Add `InboxConfig { allow_auto_reply: bool }` |
| `src/cli/commands/rules.rs` | `--forward-to`, `--reply-prompt` flags on `add`/`edit` |
| `src/refresh.rs` | Invoke action pass after triage |

---

## Out of Scope for v1

- `tag` or `label` actions (organize without side-effect)
- Webhook / HTTP POST action
- Per-rule reply cooldown configuration (global cooldown is sufficient for v1)
- Multi-step rules ("forward AND draft-reply")
