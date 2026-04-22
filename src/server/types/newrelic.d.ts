declare module 'newrelic' {
  const newrelic: {
    setTransactionName: (name: string) => void
  }
  export default newrelic
}
