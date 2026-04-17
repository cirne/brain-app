import { createServer as createNetServer } from 'node:net'

/** True when listen() failed because the TCP port is already bound. */
export function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'EADDRINUSE'
  )
}

export function duplicateDevListenMessage(port: number): string {
  return (
    `[brain-app] Port ${port} already in use — Brain requires this port (Gmail OAuth redirect is ` +
    `registered for http://127.0.0.1:${port}/api/oauth/google/callback). Free the port or stop the other listener.`
  )
}

/**
 * Returns true if nothing is listening on `port` (we can start Vite + HTTP).
 * Returns false if the port is taken (e.g. another `npm run dev`).
 * Must run **before** `createViteServer` so we do not spin up a second Vite HMR WebSocket (e.g. :24678).
 */
export function probeDevPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const s = createNetServer()
    s.once('error', (e: Error & { code?: string }) => {
      s.removeAllListeners()
      if (e.code === 'EADDRINUSE') {
        resolve(false)
        return
      }
      reject(e)
    })
    s.once('listening', () => {
      s.close((err) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
    s.listen(port)
  })
}
