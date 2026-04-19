import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { onboardingDataDir } from './onboardingState.js'

const FILENAME = 'preferences.json'

export type OnboardingMailProvider = 'apple' | 'google'

export type OnboardingPreferences = {
  mailProvider?: OnboardingMailProvider
}

function preferencesPath(): string {
  return join(onboardingDataDir(), FILENAME)
}

export async function readOnboardingPreferences(): Promise<OnboardingPreferences> {
  try {
    const raw = await readFile(preferencesPath(), 'utf-8')
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== 'object') return {}
    const o = j as Record<string, unknown>
    const mailProvider = o.mailProvider
    if (mailProvider === 'apple' || mailProvider === 'google') {
      return { mailProvider }
    }
    return {}
  } catch {
    return {}
  }
}

export async function saveOnboardingPreferences(p: OnboardingPreferences): Promise<void> {
  await mkdir(onboardingDataDir(), { recursive: true })
  const out = Object.keys(p).length === 0 ? '{}\n' : `${JSON.stringify(p, null, 2)}\n`
  await writeFile(preferencesPath(), out, 'utf-8')
}
