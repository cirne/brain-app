// #region agent log
/** Debug-only: why Tauri window feels “too small” / clips UI (session 26472a). */
const INGEST = 'http://127.0.0.1:7497/ingest/4d6eee4f-9729-40ee-87e3-62a37bfb0e67'
const SESSION = '26472a'

function send(payload: Record<string, unknown>): void {
  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION },
    body: JSON.stringify({ sessionId: SESSION, ...payload, timestamp: Date.now() }),
  }).catch(() => {})
}

function logWindowMetrics(phase: string, hypothesisId: string): void {
  const appEl = document.getElementById('app')
  const br = appEl?.getBoundingClientRect()
  const innerH = window.innerHeight
  const docScrollH = document.documentElement.scrollHeight
  const overflowY = docScrollH > innerH + 2

  send({
    hypothesisId,
    location: 'debugTauriWindowMetrics.ts',
    message: `viewport_${phase}`,
    data: {
      phase,
      innerW: window.innerWidth,
      innerH,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      docClientH: document.documentElement.clientHeight,
      docScrollH,
      bodyScrollH: document.body?.scrollHeight,
      appRectH: br?.height,
      appRectTop: br?.top,
      /** H2: content taller than viewport → scrollbar / clipping */
      overflowLikely: overflowY,
      tauri: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
    },
    runId: 'win-size-debug',
  })

  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const w = getCurrentWindow()
      void Promise.all([w.innerSize(), w.outerSize(), w.scaleFactor()])
        .then(([inner, outer, sf]) => {
          send({
            hypothesisId: 'H3',
            location: 'debugTauriWindowMetrics.ts',
            message: `tauri_physical_${phase}`,
            data: {
              phase,
              innerPhysical: { w: inner.width, h: inner.height },
              outerPhysical: { w: outer.width, h: outer.height },
              scaleFactor: sf,
            },
            runId: 'win-size-debug',
          })
        })
        .catch((e: unknown) => {
          send({
            hypothesisId: 'H3',
            location: 'debugTauriWindowMetrics.ts',
            message: `tauri_size_error_${phase}`,
            data: { err: String(e) },
            runId: 'win-size-debug',
          })
        })
    })
  }
}

/** Call once from main after mount. */
export function instrumentTauriWindowSizeDebug(): void {
  logWindowMetrics('after_mount', 'H1')
  requestAnimationFrame(() => {
    logWindowMetrics('raf1', 'H2')
    requestAnimationFrame(() => {
      logWindowMetrics('raf2', 'H2')
    })
  })
  window.addEventListener('load', () => logWindowMetrics('window_load', 'H2'))
}
// #endregion
