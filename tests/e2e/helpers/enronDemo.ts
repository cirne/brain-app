/** Registry keys for Enron demo personas (three seeded tenants). */
export const ENRON_DEMO_PERSONAS = ['kean', 'lay', 'skilling'] as const

export type EnronDemoPersona = (typeof ENRON_DEMO_PERSONAS)[number]

/** Default impersonation: Steve Kean (`kean`). */
export const DEFAULT_ENRON_DEMO_PERSONA: EnronDemoPersona = 'kean'

/** Secret for Bearer mint + demo session routes (`BRAIN_ENRON_DEMO_SECRET`). */
export function getEnronDemoSecret(): string | undefined {
  return process.env.BRAIN_ENRON_DEMO_SECRET?.trim()
}
