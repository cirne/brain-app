import type { Page } from '@playwright/test'

export type AttachAssistantChatPageDiagnosticsOptions = {
  /** Prefix for ad-hoc browser logs, e.g. `chat-smoke` */
  logTag: string
  runtimeErrors: string[]
}

/** Console / network / pageerror hooks shared by assistant-chat UI tests. */
export function attachAssistantChatPageDiagnostics(
  page: Page,
  options: AttachAssistantChatPageDiagnosticsOptions,
): void {
  const { logTag, runtimeErrors } = options
  const p = `[${logTag}]`

  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`${p}[browser:response>=400]`, {
        status: res.status(),
        url: res.url(),
        method: res.request().method(),
      })
    }
  })
  page.on('console', (msg) => console.log(`${p}[browser:${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => {
    const message = err.message
    if (/WebSocket closed without opened\./i.test(message)) {
      console.log(`${p}[browser:pageerror:ignored]`, message)
      return
    }
    runtimeErrors.push(message)
    console.log(`${p}[browser:pageerror]`, err.message)
  })
}
