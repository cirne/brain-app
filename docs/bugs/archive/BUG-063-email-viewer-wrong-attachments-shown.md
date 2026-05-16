# BUG-063 — Email viewer shows attachments from unrelated emails

**Status:** Fixed  
**Severity:** Critical — private/sensitive content from one email is displayed inside a different, unrelated email thread, with full image rendering.

---

## Description

The email viewer in the Inbox panel is showing image attachments that do not belong to the email being viewed. Specifically:

- A thread about "Golf course construction" contains three images in the viewer.
- The first and third are correct (golf course photos sent by Lance St.Clair on May 4).
- The **second image is a scan of a medical document** — it belongs to a completely different email and was never sent in this thread. The sender of the golf email would never have sent this.

Verified against Superhuman (another email client): the golf thread contains only golf course photos. The medical document scan is not present anywhere in that thread.

---

## Observed behavior

The Inbox viewer renders a `visualArtifacts` array for a single message. One of the artifacts is an image from a different email entirely. The image renders inline in the email body panel, making it appear as though it was sent by the same sender in the same thread.

---

## Root cause hypotheses

### Hypothesis 1 (most likely): Attachment file path collision

In `src/server/ripmail/sync/persist.ts`, attachment files on disk are named:

```typescript
storedPath = join(attDir, `${msg.uid}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
```

The UID is the **IMAP UID within a folder**, not a globally unique identifier. Two messages in **different IMAP folders** (e.g. `INBOX` vs `[Gmail]/All Mail`, or `INBOX` vs `Sent`) can have the **same UID**. If both messages have an attachment with the same filename (e.g. `image.jpg`, `photo.jpeg`, `IMG_1234.jpeg`, etc.), the second message's attachment write will **silently overwrite** the first message's file on disk.

The `attachments` DB rows correctly point to their respective `message_id`, but both rows end up referencing the **same on-disk file path**. When the golf email's attachment is resolved, the file at `storedPath` now contains the medical document.

All attachments for a given source land in a single flat directory: `$RIPMAIL_HOME/<sourceId>/attachments/`. There is no per-message subdirectory to prevent collisions.

### Hypothesis 2: Thread ID grouping bug pulls in sibling-thread attachments

In `src/server/ripmail/sync/parse.ts`, the thread ID derivation only looks at `In-Reply-To`:

```typescript
const threadId = inReplyTo
  ? (inReplyTo.startsWith('<') ? inReplyTo.slice(1, -1) : inReplyTo)
  : messageId
```

This is single-level only — `In-Reply-To` points to the immediate parent, not the root. If two unrelated messages happen to share the same `In-Reply-To` (e.g. a forwarded root or a reply storm), they would both land in the same `thread_id`. If the inbox panel were fetching attachments by `thread_id` rather than individual `message_id`, this could surface cross-thread attachments.

However, the current viewer code fetches a single message by `message_id` via `/api/ripmail/entry/:id`, and `readMailForDisplay` → `listAttachments` queries `WHERE message_id = ?`. So this hypothesis would only be triggering if the thread panel is somehow showing artifacts from multiple messages in the wrong message slot.

### Hypothesis 3: `visualArtifacts` mixing between thread messages in the UI

The Inbox component opens one message at a time. If the UI ever renders multiple thread messages (prior iterations, or if the thread expander was added), and the `visualArtifacts` array is not scoped per-message but instead accumulated across the thread, attachments from earlier messages could be shown in a later one's render slot.

Currently `Inbox.svelte` uses `threadContentFromMessage(message)` which takes `message.visualArtifacts` directly. This path looks clean. But if there is any caching/state bleed between thread-message transitions, stale artifacts from a previous message render could remain visible.

---

## Most likely fix

**Hypothesis 1 is the primary suspect.** Fix: use a per-message subdirectory (or include the `message_id` hash in the filename) to ensure attachment paths are globally unique within a source:

```typescript
// Option A: per-message subdir
const attDir = join(ripmailHome, msg.sourceId, 'attachments', msg.uid.toString())

// Option B: include message ID hash in filename (avoids deep nesting)
const msgHash = msg.messageId.slice(0, 16).replace(/[^a-zA-Z0-9]/g, '_')
storedPath = join(attDir, `${msg.uid}-${msgHash}-${att.filename.replace(...)}`)
```

Additionally, the DB row `stored_path` is the authoritative link between `message_id` and file bytes — but if two DB rows share the same `stored_path`, corruption is silent and undetectable at read time.

---

## Data privacy impact

This is not just a display glitch. The medical document screenshot shown in the screenshots includes:
- Patient name (Katelyn)
- Clinical recommendations (stopping a medication, starting a new one)
- Dosage and lab context
- Name of the treating physician

This content was rendered to the user in the context of a completely unrelated email from a different sender, with no indication it was misplaced.

---

## Files to investigate

- `src/server/ripmail/sync/persist.ts` — attachment file storage path construction
- `src/server/ripmail/sync/parse.ts` — thread ID derivation (single-level `In-Reply-To` only)
- `src/server/ripmail/mailRead.ts` — `listAttachments` and `readMailForDisplay`
- `src/server/ripmail/visualArtifacts.ts` — `visualArtifactsFromAttachments`
- `src/client/components/Inbox.svelte` — `threadContentFromMessage`, state between thread transitions

---

## Repro

1. Have two emails in different IMAP folders with the same UID and attachments sharing the same filename (e.g. both named `image.jpeg`).
2. Sync both.
3. Open either email in the inbox viewer — the image shown may belong to the other email.

A simpler repro may be obtainable by checking the on-disk `attachments/` directory for duplicate filenames across messages.
