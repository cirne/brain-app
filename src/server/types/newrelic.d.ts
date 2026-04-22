declare module 'newrelic' {
  const newrelic: {
    setTransactionName: (name: string) => void
    recordCustomEvent: (
      eventType: string,
      attributes: Record<string, string | number | boolean>,
    ) => void
  }
  export default newrelic
}
