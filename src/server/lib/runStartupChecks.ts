import { logStartupDiagnostics } from './startupDiagnostics.js'
import { verifyLlmAtStartup } from './llmStartupSmoke.js'

/** After HTTP listen so the desktop shell can connect even when LLM keys are missing at first boot. */
export async function runStartupChecks(listenPort?: number): Promise<void> {
  try {
    await logStartupDiagnostics(listenPort)
  } catch (e) {
    console.error('[brain-app] startup diagnostics failed:', e)
  }
  try {
    await verifyLlmAtStartup()
  } catch (e) {
    console.error('[brain-app] LLM startup check failed (server is still running):', e)
  }
}
