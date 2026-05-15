/**
 * Vitest (server project): initialize client i18n so {@link translateClient} works when server
 * tests import modules that resolve policy labels (e.g. `brainAccessPolicyGrouping`).
 */
import { initI18n, setLanguage } from '@client/lib/i18n/index.js'

await initI18n({ forceLanguage: 'en' })
await setLanguage('en')
