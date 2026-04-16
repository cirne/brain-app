/** True when listen() failed because the TCP port is already bound. */
export function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
  )
}

export function duplicateDevListenMessage(port: number): string {
  return `[brain-app] Port ${port} already in use — assuming dev server is running (e.g. another terminal). Skipping duplicate listen.`
}
