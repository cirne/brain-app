/**
 * When true, `send_draft` appends `ripmail send --dry-run` (no SMTP / Gmail send).
 * Set by the JSONL eval harness; override in `.env` or shell: `EVAL_RIPMAIL_SEND_DRY_RUN=0` for a live send.
 */
export function isEvalRipmailSendDryRun(): boolean {
  const v = process.env.EVAL_RIPMAIL_SEND_DRY_RUN
  if (v === undefined || v.trim() === '') return false
  const t = v.trim()
  if (t === '0' || /^false$/i.test(t) || t === 'no' || t === 'off') return false
  if (t === '1' || /^true$/i.test(t) || t === 'yes' || t === 'on') return true
  return false
}
