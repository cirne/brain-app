declare module 'newrelic' {
  const newrelic: {
    /** Application logging; forwarded by the agent when `application_logging.forwarding.enabled` is true in `newrelic.cjs`. */
    recordLogEvent: (event: Record<string, unknown>) => void
    setTransactionName: (name: string) => void
    /** Sets `enduser.id` on the current transaction, traces, and errors. */
    setUserID: (id: string) => void
    recordCustomEvent: (
      eventType: string,
      attributes: Record<string, string | number | boolean>,
    ) => void
    addCustomAttribute: (key: string, value: string | number | boolean) => false | undefined
    /** Active web transaction handle, or `undefined` when none (e.g. background work). */
    getTransaction?: () =>
      | {
          insertDistributedTraceHeaders: (headers: Record<string, string | string[] | undefined>) => void
        }
      | undefined
    startSegment: <T>(
      name: string,
      record: boolean,
      handler: (cb?: () => void) => T,
      callback?: () => void,
    ) => T
  }
  export default newrelic
}
