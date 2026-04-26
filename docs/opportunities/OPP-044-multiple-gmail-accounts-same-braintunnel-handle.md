# OPP-044: Multiple email accounts, one Braintunnel handle

## Summary

A user should be able to **authorize a second (or Nth) Gmail** (and later other mailbox types) and still be **one Braintunnel identity**—**one handle**, one vault, one wiki profile—not a new account per mailbox.

**Ripmail already supports multiple mailboxes** in one install: unified `ripmail.db`, `mailboxes[]` in `config`, per-mailbox sync and `mailbox_id` in the index (see [ripmail OPP-016 — Multi-Inbox, archived](../ripmail/docs/opportunities/archive/OPP-016-multi-inbox.md), and [ripmail OPP-044 — per-mailbox config, archived](../ripmail/docs/opportunities/archive/OPP-044-per-mailbox-sync-and-smtp-config.md) for follow-on modeling). The product gap is **Braintunnel (brain-app)**: how **Google OAuth and session** map to **linked mailboxes** under a single user, plus Hub and agent UX.

## Problem

- People commonly have **work and personal** Gmail; forcing a single "primary" OAuth mailbox is a ceiling on usefulness.
- **Inter-brain and social identity** are handle-first ([OPP-042](OPP-042-brain-network-interbrain-trust-epic.md)); that should not multiply when a user adds another inbox.

## Motivation

- Match real-world **one person, many mailboxes** without fragmenting product identity.
- Reuse the **local-first** ripmail stack instead of re-solving indexing.

---

## Current Architecture (as of 2026-04)

### Identity and Authentication

1. **Multi-tenant identity:** `google:<sub>` → `usr_<uuid>` (tenant user ID) in `tenant-registry.json`. One Google identity = one workspace.
2. **First Gmail OAuth creates the workspace:** `resolveOrProvisionWorkspace(sub, email)` in `googleIdentityWorkspace.ts` either finds an existing tenant or provisions a new one.
3. **Session binding:** OAuth callback creates a `brain_session` cookie tied to the tenant user ID. Subsequent requests resolve the session to the tenant home directory.
4. **Desktop (single-tenant):** No tenant registry; vault password gates access. Gmail OAuth writes tokens to ripmail home but doesn't create identity mappings.

### Ripmail Multi-Source (already shipped)

Ripmail's `config.json` uses a unified `**sources[]`** array (OPP-051 model):

```json
{
  "sources": [
    {
      "id": "work_example_com",
      "kind": "imap",
      "email": "work@example.com",
      "imapAuth": "googleOAuth",
      "search": { "includeInDefault": true }
    },
    {
      "id": "personal_gmail_com",
      "kind": "imap",
      "email": "personal@gmail.com",
      "imapAuth": "googleOAuth",
      "search": { "includeInDefault": false }
    }
  ]
}
```

- **Single SQLite DB** with `source_id` on all rows.
- `**--source` flag** on CLI commands to scope operations (accepts email or id).
- `**search.includeInDefault`** controls whether a source is included in default searches.
- **Per-source tokens:** `<source_id>/google-oauth.json` for OAuth credentials.

**Note:** The older `mailboxes[]` key is obsolete; ripmail removes it on config load. Code aliases like `resolve_mailbox_spec` → `resolve_source_spec` exist for back-compat.

### Calendar Visibility Pattern (reference)

The `calendar` tool's `op: 'configure_source'` accepts:

- `calendar_ids`: calendars to sync/index.
- `default_calendar_ids`: calendars shown in default queries.

This pattern translates directly to mailbox visibility.

---

## Proposed Design

### 1. Account Linking Architecture

**Distinction: "Primary" vs "Linked" identities.**

The **first** Google OAuth creates the user's Braintunnel identity and workspace. Subsequent OAuth connections **link** additional mailboxes to the same workspace without creating new identities.

#### Tenant Registry Extension

Extend `tenant-registry.json` to support multiple identities per tenant:

```json
{
  "v": 2,
  "sessions": { "<sessionId>": "usr_abc123" },
  "identities": {
    "google:<sub1>": "usr_abc123",
    "google:<sub2>": "usr_abc123"
  },
  "primaryIdentity": {
    "usr_abc123": "google:<sub1>"
  }
}
```

- `**identities**`: Multiple `google:<sub>` keys can map to the same `usr_...`.
- `**primaryIdentity**`: The identity used for "sign in" (vs "add account"). The primary determines which Google account can log in to the workspace; linked accounts are for mail/calendar only.

#### Alternative: Linked-Mailboxes File

Store linked mailboxes per-tenant instead of in the global registry:

```
$BRAIN_HOME/linked-mailboxes.json
```

```json
{
  "mailboxes": [
    { "email": "work@example.com", "googleSub": "sub1", "linkedAt": "2026-04-20T..." },
    { "email": "personal@gmail.com", "googleSub": "sub2", "linkedAt": "2026-04-26T..." }
  ]
}
```

This avoids growing the global registry and keeps tenant data self-contained. The global registry's `identities` map still only tracks the **primary** (sign-in) identity.

**Recommendation:** Per-tenant `linked-mailboxes.json` for mailbox metadata; `tenant-registry.json` primary identity only.

### 2. OAuth Flow Variants

#### First Gmail (Sign-In / Account Creation)

1. User lands on `/` with no session → shown "Sign in with Google".
2. OAuth callback to `/api/oauth/google/callback`:
  - `resolveOrProvisionWorkspace(sub, email)` creates new `usr_...` tenant.
  - Writes ripmail config and tokens.
  - Creates session → redirect to onboarding.
3. Full onboarding: profiling, wiki seeding, etc.

#### Add Gmail (Linking to Existing Account)

1. User is **already signed in** (valid `brain_session`).
2. User navigates to Hub → Sources → "Add another Gmail account".
3. New OAuth route: `/api/oauth/google/link/start` — same consent flow but different callback behavior.
4. Callback to `/api/oauth/google/link/callback`:
  - Resolves **existing** session to tenant (does not provision new workspace).
  - Adds new source to ripmail config using `upsertRipmailConfig(ripmailHome, newSourceId, email)`.
  - Writes OAuth tokens to `<source_id>/google-oauth.json`.
  - Updates `linked-mailboxes.json` with metadata.
  - **No onboarding** — redirect to Hub with success toast.
5. Triggers background sync for the new source.

**Key difference:** `/link/callback` requires a valid session and operates on the existing tenant. It does not touch `tenant-registry.json` identities (the new Google sub is not a "sign-in" identity).

### 3. Hub UX for Multi-Mailbox

#### Hub Sources View

Current: Shows all ripmail sources (mail, calendar, local dirs).

**Enhanced for multi-mailbox:**

```
┌─────────────────────────────────────────────┐
│ Search index                                │
│                                             │
│ 15,234 messages in index · Synced 5m ago    │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ 📧 work@company.com           ✓ Default │ │
│ │    Email (IMAP) · 12,450 msgs           │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 📧 personal@gmail.com                   │ │
│ │    Email (IMAP) · 2,784 msgs            │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 📅 Google Calendar (work)     ✓ Default │ │
│ │    5 calendars synced                   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [+ Add another Gmail account]               │
│ [+ Add folders] (desktop only)              │
└─────────────────────────────────────────────┘
```

#### Source Inspect Panel (Mail Source Detail)

Clicking a mail source opens `HubSourceInspectPanel` with:

- **Search visibility toggle:** "Include in default searches" (maps to `search.includeInDefault`).
- **Default send source:** Radio selection across all IMAP sources — "Send from this address by default".
- **Sync status:** Last sync, message count, sync errors.
- **Remove account:** Disconnects the source (removes from config, deletes local tokens, optionally purges indexed messages).

### 4. Agent Tool Scoping

#### Current Behavior

- `search_email`: Searches all IMAP sources in the ripmail index.
- `read_email`: Reads any message by ID.
- `send_email`: Uses... which source? (ambiguous today)

#### Enhanced Behavior

**Search:**

```typescript
search_email({
  query: "from:alice",
  source: "work@company.com",  // optional: scope to one source
  // omit source → searches all with includeInDefault=true
})
```

Maps to `ripmail search --source <email>` when specified.

**Agent heuristics:**

1. When user says "search my work email" or "in my company inbox", agent passes `source: "work@..."`.
2. When user says "search all my email" or doesn't specify, agent omits source (uses defaults).
3. When a source has `includeInDefault: false`, agent mentions it's excluded unless explicitly requested.

**Send:**

```typescript
send_email({
  to: "bob@example.com",
  subject: "...",
  body: "...",
  from: "work@company.com",  // optional: explicit send-as
  // omit from → uses default send mailbox from config
})
```

The `from` parameter is optional; when omitted, uses the user's configured default send source. When specified, validates that the source exists and has valid credentials.

**Default send source:**

Add to ripmail config at root level:

```json
{
  "defaultSendSource": "work_example_com",
  "sources": [...]
}
```

Set via Hub or `ripmail config --default-send-source work@example.com`.

### 5. Ripmail CLI Enhancements

Most multi-source CLI support is already shipped. Remaining work:


| Command          | Current                  | Enhancement                                      |
| ---------------- | ------------------------ | ------------------------------------------------ |
| `ripmail send`   | Uses first source or env | Respect `defaultSendSource` from config          |
| `ripmail status` | Shows per-source status  | Add `(default search)` / `(default send)` labels |
| `ripmail config` | `--mailbox-management`   | Add `--default-send-source <email>`              |


### 6. Onboarding Impact

**First Gmail (full onboarding):**

- Unchanged: profiling → wiki seeding → ready.

**Add Gmail (zero onboarding):**

- OAuth consent → success toast → back to Hub.
- Background sync starts automatically.
- Agent can immediately search the new source (progressively, as sync completes).

**Handle confirmation (stretch goal):**

- If user hasn't confirmed their Braintunnel handle, adding a second account is a good moment to prompt. But this is optional polish, not a blocker.

---

## Implementation Phases

### Phase 1: Add-Account OAuth Flow

1. **New routes:** `/api/oauth/google/link/start` and `/api/oauth/google/link/callback`.
2. **Callback logic:** Validate session → add mailbox to ripmail config → write tokens → return success.
3. **Hub "Add Gmail" button:** Navigates to `/api/oauth/google/link/start`.
4. **Basic success feedback:** Redirect back to Hub with `?linked=email@...` query param → show toast.

### Phase 2: Hub Mailbox Management

1. **Enhanced source rows:** Show per-mailbox message count, sync status.
2. **Source inspect panel:** Toggle `includeInDefault`, set default send mailbox, remove account.
3. **Agent tool updates:** Pass `mailbox` param through to ripmail CLI.

### Phase 3: Agent Intelligence

1. **Smart mailbox inference:** Agent detects "work email" / "personal email" from context.
2. **Explicit scope announcements:** When a search excludes hidden mailboxes, agent notes it.
3. **Send-as selection:** When composing, agent asks which address to send from if ambiguous (or uses default).

### Phase 4: Polish and Edge Cases

1. **Duplicate prevention:** If user tries to add a Gmail that's already linked, show error.
2. **Primary identity disambiguation:** If user tries to sign in with a linked (non-primary) identity, explain the situation.
3. **Migration:** If an existing user has only one IMAP source, auto-mark it as default send.
4. **Calendar integration:** When adding Gmail, also add `googleCalendar` source for that account's calendars.

---

## Security Considerations

- **Token isolation:** Each source's OAuth tokens are stored separately (`<source_id>/google-oauth.json`). Revoking one doesn't affect others.
- **Session binding:** The add-account flow requires a valid session; unauthenticated requests can't link sources to arbitrary tenants.
- **Primary identity protection:** Only the primary identity can sign in. Linked identities are for data access only.
- **Hosted delete-all:** Deleting the account removes all sources and tokens.

---

## Non-goals (initially)

- **Fully automatic "same human" unification** in contacts across mailboxes (may intersect [OPP-037](OPP-037-messages-index-and-unified-people.md) later).
- **Non-Gmail connectors** beyond what ripmail + OAuth flows already support—sequence after Gmail N-mailbox is credible.
- **Multiple primary identities** (sign in with any linked Gmail)—keep it simple: one primary, N linked.

---

## Related

- [OPP-019](OPP-019-gmail-first-class-brain.md) — Gmail OAuth, shared on-disk with ripmail.
- [ripmail OPP-016 (archived)](../ripmail/docs/opportunities/archive/OPP-016-multi-inbox.md) — multi-mailbox architecture.
- [ripmail OPP-051 — unified sources](../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) — corpus and connectors.
- [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) — Google OAuth verification caps (may affect how many "test users" or consent surfaces you maintain).

**Status:** Open — Phase 1 ready to implement