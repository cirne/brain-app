/**
 * Placeholders for Slack / external-channel integration (OPP-117/118).
 *
 * - PolicyEvaluator — per-contact and integration-scoped rules before outbound Slack text
 * - integrationAgent — dedicated pi-agent for external channel intake (Slack; Teams later):
 *   shared corpus tools (mail/wiki/calendar) + channel routing tools; not assistantAgent or b2bAgent
 * - ApprovalRequest — draft → approve → send via MessagingAdapter (Block Kit for Slack)
 */
