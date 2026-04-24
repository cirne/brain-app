declare module 'newrelic' {
  const newrelic: {
    setTransactionName: (name: string) => void
    recordCustomEvent: (
      eventType: string,
      attributes: Record<string, string | number | boolean>,
    ) => void
    addCustomAttribute: (key: string, value: string | number | boolean) => false | undefined
    startSegment: <T>(
      name: string,
      record: boolean,
      handler: (cb?: () => void) => T,
      callback?: () => void,
    ) => T
  }
  export default newrelic
}
