/**
 * Draft lifecycle — new, reply, forward, edit, view.
 * Drafts are stored as Markdown+YAML files under <ripmail_home>/drafts/.
 * Phase 1: stub implementation (returns meaningful error until Phase 2 sync lands).
 * Phase 2 will implement full LLM compose + SMTP send.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Draft } from './types.js'
import type { RipmailDb } from './db.js'

function draftsDir(ripmailHome: string): string {
  return join(ripmailHome, 'drafts')
}

function draftPath(ripmailHome: string, draftId: string): string {
  return join(draftsDir(ripmailHome), `${draftId}.json`)
}

function saveDraft(ripmailHome: string, draft: Draft): void {
  mkdirSync(draftsDir(ripmailHome), { recursive: true })
  writeFileSync(draftPath(ripmailHome, draft.id), JSON.stringify(draft, null, 2), 'utf8')
}

function loadDraft(ripmailHome: string, draftId: string): Draft | null {
  const p = draftPath(ripmailHome, draftId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Draft
  } catch {
    return null
  }
}

export interface NewDraftOptions {
  to: string
  /** Placeholder body text when `body` is omitted (agent / CLI LLM flows). */
  instruction?: string
  sourceId?: string
  withBody?: boolean
  /** In-process compose: explicit RFC-style fields instead of CLI LLM. */
  subject?: string
  body?: string
}

export interface ReplyDraftOptions {
  messageId: string
  instruction: string
  sourceId?: string
  withBody?: boolean
}

export interface ForwardDraftOptions {
  messageId: string
  to: string
  instruction: string
  sourceId?: string
  withBody?: boolean
}

export interface EditDraftOptions {
  instruction?: string
  subject?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  addTo?: string[]
  addCc?: string[]
  addBcc?: string[]
  removeTo?: string[]
  removeCc?: string[]
  removeBcc?: string[]
}

/**
 * Create a new draft. Without explicit `subject`/`body`, uses placeholders from `instruction`.
 */
export function draftNew(_db: RipmailDb, ripmailHome: string, opts: NewDraftOptions): Draft {
  const now = new Date().toISOString()
  const instruction = opts.instruction ?? ''
  const draft: Draft = {
    id: randomUUID(),
    subject: opts.subject ?? '(draft — set subject via edit_draft)',
    body: opts.body ?? `[Draft body — instruction: ${instruction}]`,
    to: [opts.to],
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  }
  saveDraft(ripmailHome, draft)
  return draft
}

/**
 * Create a reply draft.
 */
export function draftReply(db: RipmailDb, ripmailHome: string, opts: ReplyDraftOptions): Draft {
  const original = db
    .prepare(`SELECT subject, from_address FROM messages WHERE message_id = ?`)
    .get(opts.messageId) as { subject: string; from_address: string } | undefined
  const now = new Date().toISOString()
  const draft: Draft = {
    id: randomUUID(),
    subject: original ? `Re: ${original.subject}` : 'Re: (unknown)',
    body: `[Reply draft — instruction: ${opts.instruction}]`,
    to: original ? [original.from_address] : [],
    inReplyToMessageId: opts.messageId,
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  }
  saveDraft(ripmailHome, draft)
  return draft
}

/**
 * Create a forward draft.
 */
export function draftForward(db: RipmailDb, ripmailHome: string, opts: ForwardDraftOptions): Draft {
  const original = db
    .prepare(`SELECT subject FROM messages WHERE message_id = ?`)
    .get(opts.messageId) as { subject: string } | undefined
  const now = new Date().toISOString()
  const draft: Draft = {
    id: randomUUID(),
    subject: original ? `Fwd: ${original.subject}` : 'Fwd: (unknown)',
    body: `[Forward draft — instruction: ${opts.instruction}]`,
    to: [opts.to],
    forwardMessageId: opts.messageId,
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  }
  saveDraft(ripmailHome, draft)
  return draft
}

/**
 * Edit an existing draft.
 */
export function draftEdit(ripmailHome: string, draftId: string, opts: EditDraftOptions): Draft {
  const draft = loadDraft(ripmailHome, draftId)
  if (!draft) throw new Error(`Draft not found: ${draftId}`)
  const now = new Date().toISOString()

  function applyRecipientEdits(
    current: string[] | undefined,
    replace?: string[],
    add?: string[],
    remove?: string[],
  ): string[] | undefined {
    let result = replace ?? current ?? []
    if (add?.length) result = [...result, ...add]
    if (remove?.length) {
      const removeSet = new Set(remove.map((s) => s.toLowerCase()))
      result = result.filter((r) => !removeSet.has(r.toLowerCase()))
    }
    return result.length > 0 ? result : undefined
  }

  const updated: Draft = {
    ...draft,
    subject: opts.subject ?? draft.subject,
    to: applyRecipientEdits(draft.to, opts.to, opts.addTo, opts.removeTo),
    cc: applyRecipientEdits(draft.cc, opts.cc, opts.addCc, opts.removeCc),
    bcc: applyRecipientEdits(draft.bcc, opts.bcc, opts.addBcc, opts.removeBcc),
    body: opts.instruction ? `[Edited — instruction: ${opts.instruction}]\n\n${draft.body}` : draft.body,
    updatedAt: now,
  }
  saveDraft(ripmailHome, updated)
  return updated
}

/**
 * View a draft.
 */
export function draftView(ripmailHome: string, draftId: string): Draft | null {
  return loadDraft(ripmailHome, draftId)
}

/**
 * List all drafts.
 */
export function draftList(ripmailHome: string): Draft[] {
  const dir = draftsDir(ripmailHome)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8')) as Draft
      } catch {
        return null
      }
    })
    .filter((d): d is Draft => d != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
