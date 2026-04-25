import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'

/** Shell-escaped `ripmail search … --json` command line for tests and tooling. */
export function buildRipmailSearchCommandLine(params: {
  /** Regex pattern; omit when using only structured filters. */
  query?: string
  pattern?: string
  caseSensitive?: boolean
  from?: string
  to?: string
  after?: string
  before?: string
  subject?: string
  category?: string
  source?: string
}): string {
  const rm = ripmailBin()
  const q = (params.pattern ?? params.query ?? '').trim()
  const j = (s: string) => JSON.stringify(s)
  const parts: string[] = [rm, 'search']
  if (q.length > 0) {
    parts.push(j(q))
  }
  if (params.from?.trim()) {
    parts.push('--from', j(params.from.trim()))
  }
  if (params.to?.trim()) {
    parts.push('--to', j(params.to.trim()))
  }
  if (params.after?.trim()) {
    parts.push('--after', j(params.after.trim()))
  }
  if (params.before?.trim()) {
    parts.push('--before', j(params.before.trim()))
  }
  if (params.subject?.trim()) {
    parts.push('--subject', j(params.subject.trim()))
  }
  if (params.category?.trim()) {
    parts.push('--category', j(params.category.trim()))
  }
  if (params.caseSensitive) {
    parts.push('--case-sensitive')
  }
  parts.push('--json')
  if (params.source?.trim()) {
    parts.push('--source', j(params.source.trim()))
  }
  return parts.join(' ')
}

/** Build `ripmail …` argv after the binary name (e.g. `rules list`). Used by inbox_rules and tests. */
export function buildInboxRulesCommand(params: {
  op: 'list' | 'validate' | 'show' | 'add' | 'edit' | 'remove' | 'move' | 'feedback'
  /** Per-account rules overlay (email or source id) */
  source?: string
  sample?: boolean
  rule_id?: string
  rule_action?: 'ignore' | 'notify' | 'inform'
  /**
   * Subject+body regex/FTS pattern only. Do not put `from:`, `subject:`, or `category:` tokens here—ripmail rejects them.
   * Use `from` / `subject` / `category` parameters instead (same as `ripmail search` flags).
   */
  query?: string
  /** Structured From filter (`ripmail rules add --from` / search --from). */
  from?: string
  /** Structured To filter. */
  to?: string
  /** Structured Subject filter. */
  subject?: string
  /** Category label (sync metadata), e.g. promotional. */
  category?: string
  /**
   * When both `from` and `to` are set on add, pass true so the rule matches if either address applies.
   */
  from_or_to_union?: boolean
  insert_before?: string
  description?: string
  preview_window?: string
  /**
   * add: omit or true = classify the whole email thread when any message matches (ripmail default).
   * add: false = `--message-only` (match individual messages only).
   * edit: set true/false to run `--whole-thread` / `--message-only`; omit to leave `threadScope` unchanged.
   */
  apply_to_thread?: boolean
  before_rule_id?: string
  after_rule_id?: string
  feedback_text?: string
}): string {
  const mb = params.source?.trim()
    ? ` --source ${JSON.stringify(params.source.trim())}`
    : ''
  switch (params.op) {
    case 'list':
      return `rules list${mb}`
    case 'validate':
      return `rules validate${params.sample ? ' --sample' : ''}${mb}`
    case 'show': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=show')
      return `rules show ${JSON.stringify(params.rule_id.trim())}${mb}`
    }
    case 'add': {
      if (!params.rule_action) {
        throw new Error('rule_action is required for op=add')
      }
      const q = params.query?.trim() ?? ''
      const hasStructured = !!(
        params.from?.trim() ||
        params.to?.trim() ||
        params.subject?.trim() ||
        params.category?.trim()
      )
      if (!q && !hasStructured) {
        throw new Error('op=add requires query and/or at least one of: from, to, subject, category')
      }
      const j = JSON.stringify
      let tail = `rules add --action ${params.rule_action}`
      if (q) tail += ` --query ${j(q)}`
      if (params.from?.trim()) tail += ` --from ${j(params.from.trim())}`
      if (params.to?.trim()) tail += ` --to ${j(params.to.trim())}`
      if (params.subject?.trim()) tail += ` --subject ${j(params.subject.trim())}`
      if (params.category?.trim()) tail += ` --category ${j(params.category.trim())}`
      if (params.from_or_to_union === true) tail += ' --from-or-to-union'
      if (params.insert_before?.trim()) {
        tail += ` --insert-before ${j(params.insert_before.trim())}`
      }
      if (params.description?.trim()) {
        tail += ` --description ${j(params.description.trim())}`
      }
      if (params.preview_window?.trim()) {
        tail += ` --preview-window ${j(params.preview_window.trim())}`
      }
      if (params.apply_to_thread === false) {
        tail += ' --message-only'
      }
      return tail + mb
    }
    case 'edit': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=edit')
      const has =
        params.rule_action != null ||
        params.query != null ||
        params.preview_window != null ||
        params.apply_to_thread !== undefined ||
        params.from !== undefined ||
        params.to !== undefined ||
        params.subject !== undefined ||
        params.category !== undefined ||
        params.from_or_to_union !== undefined
      if (!has) {
        throw new Error(
          'op=edit requires at least one of: rule_action, query, from, to, subject, category, from_or_to_union, preview_window, apply_to_thread',
        )
      }
      const j = JSON.stringify
      let tail = `rules edit ${j(params.rule_id.trim())}`
      if (params.rule_action != null) tail += ` --action ${params.rule_action}`
      if (params.query != null) tail += ` --query ${j(params.query)}`
      if (params.from !== undefined) tail += ` --from ${j(params.from)}`
      if (params.to !== undefined) tail += ` --to ${j(params.to)}`
      if (params.subject !== undefined) tail += ` --subject ${j(params.subject)}`
      if (params.category !== undefined) tail += ` --category ${j(params.category)}`
      if (params.from_or_to_union !== undefined) {
        tail += ` --from-or-to-union ${params.from_or_to_union ? 'true' : 'false'}`
      }
      if (params.preview_window?.trim()) {
        tail += ` --preview-window ${j(params.preview_window.trim())}`
      }
      if (params.apply_to_thread === true) {
        tail += ' --whole-thread'
      } else if (params.apply_to_thread === false) {
        tail += ' --message-only'
      }
      return tail + mb
    }
    case 'remove': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=remove')
      return `rules remove ${JSON.stringify(params.rule_id.trim())}${mb}`
    }
    case 'move': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=move')
      const b = params.before_rule_id?.trim()
      const a = params.after_rule_id?.trim()
      if ((b && a) || (!b && !a)) {
        throw new Error('op=move requires exactly one of: before_rule_id, after_rule_id')
      }
      const rel = b ? `--before ${JSON.stringify(b)}` : `--after ${JSON.stringify(a!)}`
      return `rules move ${JSON.stringify(params.rule_id.trim())} ${rel}${mb}`
    }
    case 'feedback': {
      if (!params.feedback_text?.trim()) throw new Error('feedback_text is required for op=feedback')
      return `rules feedback ${JSON.stringify(params.feedback_text.trim())}${mb}`
    }
    default: {
      const x: never = params.op
      throw new Error(`Unhandled op: ${String(x)}`)
    }
  }
}

/** Build CLI flags for ripmail draft edit from metadata params. */
export function buildDraftEditFlags(params: {
  subject?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  add_to?: string[]
  add_cc?: string[]
  add_bcc?: string[]
  remove_to?: string[]
  remove_cc?: string[]
  remove_bcc?: string[]
}): string {
  const parts: string[] = []
  const flag = (name: string, values?: string[]) => {
    if (values?.length) for (const v of values) parts.push(`${name} ${JSON.stringify(v)}`)
  }
  if (params.subject) parts.push(`--subject ${JSON.stringify(params.subject)}`)
  flag('--to', params.to)
  flag('--cc', params.cc)
  flag('--bcc', params.bcc)
  flag('--add-to', params.add_to)
  flag('--add-cc', params.add_cc)
  flag('--add-bcc', params.add_bcc)
  flag('--remove-to', params.remove_to)
  flag('--remove-cc', params.remove_cc)
  flag('--remove-bcc', params.remove_bcc)
  return parts.length ? parts.join(' ') + ' ' : ''
}

/** Build `ripmail sources add --kind localDir …` argv tail after the binary name. Used by add_files_source and tests. */
export function buildSourcesAddLocalDirCommand(params: { path: string; label?: string; id?: string }): string {
  const parts = ['sources add --kind localDir', `--path ${JSON.stringify(params.path)}`]
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.id?.trim()) parts.push(`--id ${JSON.stringify(params.id.trim())}`)
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources edit …` argv tail after the binary name. */
export function buildSourcesEditCommand(params: { id: string; label?: string; path?: string }): string {
  const parts = [`sources edit ${JSON.stringify(params.id)}`]
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.path?.trim()) parts.push(`--path ${JSON.stringify(params.path.trim())}`)
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources remove …` argv tail after the binary name. */
export function buildSourcesRemoveCommand(id: string): string {
  return `sources remove ${JSON.stringify(id)} --json`
}

/** Build `ripmail refresh` argv tail: bare refresh or scoped `--source`. */
export function buildReindexCommand(params: { sourceId?: string }): string {
  if (params.sourceId?.trim()) {
    return `refresh --source ${JSON.stringify(params.sourceId.trim())}`
  }
  return 'refresh'
}
