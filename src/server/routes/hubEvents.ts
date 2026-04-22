import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { listBackgroundRuns } from '../lib/backgroundAgentStore.js'
import { registerHubSseSubscriber } from '../lib/hubSseBroker.js'
import { tryGetTenantContext } from '../lib/tenantContext.js'
import { getYourWikiDoc } from '../agent/yourWikiSupervisor.js'

const hubEvents = new Hono()

const HEARTBEAT_MS = 20_000

/** Hub / Your Wiki + background agents — server push (see docs/architecture/runtime-and-routes.md). */
hubEvents.get('/', (c) => {
  return streamSSE(c, async (stream) => {
    const ws = tryGetTenantContext()?.workspaceHandle ?? '_single'

    const wikiDoc = await getYourWikiDoc()
    const agents = await listBackgroundRuns()

    const unsub = registerHubSseSubscriber(ws, async (msg) => {
      await stream.writeSSE({ event: msg.event, data: msg.data })
    })

    try {
      await stream.writeSSE({ event: 'your_wiki', data: JSON.stringify(wikiDoc) })
      await stream.writeSSE({ event: 'background_agents', data: JSON.stringify({ agents }) })

      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: '{}' })
      }, HEARTBEAT_MS)

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            clearInterval(heartbeat)
            resolve()
          },
          { once: true },
        )
      })
    } finally {
      unsub()
    }
  })
})

export default hubEvents
