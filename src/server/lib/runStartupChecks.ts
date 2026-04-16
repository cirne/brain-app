import { logStartupDiagnostics } from './startupDiagnostics.js'
import { verifyLlmAtStartup } from './llmStartupSmoke.js'

/** After HTTP listen so Tauri can connect to :3000 even when LLM keys are missing at first boot. */
export async function runStartupChecks(): Promise<void> {
  try {
    await logStartupDiagnostics()
  } catch (e) {
    console.error('[brain-app] startup diagnostics failed:', e)
  }
  try {
    await verifyLlmAtStartup()
  } catch (e) {
    console.error('[brain-app] LLM startup check failed (server is still running):', e)
  }
}
