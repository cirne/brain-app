/** Stable idempotency key prefix — one app notification row per mail `message_id` with notify disposition. */
export function mailNotifyIdempotencyKey(messageId: string): string {
  return `mail_notify:${messageId}`
}
