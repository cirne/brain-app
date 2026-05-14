/**
 * Shared bounded-concurrency helpers for ripmail sync (Gmail, Drive, etc.).
 */

import pLimit from 'p-limit'

/** Max concurrent `users.messages.get` calls during Gmail sync. */
export const GMAIL_MESSAGES_GET_CONCURRENCY = 8

/** Max concurrent Drive file ingest (download + extract) during bootstrap / incremental. */
export const DRIVE_INGEST_CONCURRENCY = 6

/**
 * Map items through `fn` with at most `concurrency` in-flight async operations.
 */
export async function runWithConcurrencyPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency)
  return Promise.all(items.map((item) => limit(() => fn(item))))
}
