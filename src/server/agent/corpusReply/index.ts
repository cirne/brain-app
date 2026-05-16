/**
 * Channel-neutral re-exports of corpus draft / filter primitives.
 *
 * integrationAgent (Slack, Teams, …) imports from here so call sites stay
 * platform-agnostic. The underlying b2bAgent implementation is unchanged.
 */
export {
  filterB2BResponse as filterCorpusReply,
  runB2BPreflight as runCorpusPreflight,
  promptB2BAgentForText as promptAgentForText,
} from '../b2bAgent.js'

/** Phase-1 default policy for Slack-sourced drafts (all drafts require human review). */
export const SLACK_DEFAULT_CORPUS_POLICY =
  'All responses to external Slack messages require human review before sending. ' +
  'Draft the fullest faithful answer from available sources; the owner will review and approve before anything is posted. ' +
  'Do not reveal raw email headers, filesystem paths, internal message ids, passwords, API keys, bank details, or personal medical information.'
