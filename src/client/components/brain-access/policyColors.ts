import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'

/** Tailwind utility bundles for policy cards (light + dark aware). */
export type PolicyCardTone = {
  bar: string
  ring: string
  softBg: string
}

const builtinTones: Record<BrainQueryBuiltinPolicyId, PolicyCardTone> = {
  trusted: {
    bar: 'border-l-purple-500',
    ring: 'border-purple-300 dark:border-purple-700',
    softBg: 'bg-purple-50/70 dark:bg-purple-950/30',
  },
  general: {
    bar: 'border-l-blue-500',
    ring: 'border-blue-300 dark:border-blue-700',
    softBg: 'bg-blue-50/70 dark:bg-blue-950/30',
  },
  'minimal-disclosure': {
    bar: 'border-l-green-500',
    ring: 'border-green-300 dark:border-green-700',
    softBg: 'bg-green-50/70 dark:bg-green-950/30',
  },
  'server-default': {
    bar: 'border-l-slate-500',
    ring: 'border-slate-300 dark:border-slate-600',
    softBg: 'bg-slate-50/80 dark:bg-slate-900/35',
  },
}

const customRotation: PolicyCardTone[] = [
  {
    bar: 'border-l-amber-500',
    ring: 'border-amber-300 dark:border-amber-700',
    softBg: 'bg-amber-50/70 dark:bg-amber-950/25',
  },
  {
    bar: 'border-l-orange-500',
    ring: 'border-orange-300 dark:border-orange-700',
    softBg: 'bg-orange-50/70 dark:bg-orange-950/25',
  },
  {
    bar: 'border-l-pink-500',
    ring: 'border-pink-300 dark:border-pink-700',
    softBg: 'bg-pink-50/70 dark:bg-pink-950/25',
  },
  {
    bar: 'border-l-teal-500',
    ring: 'border-teal-300 dark:border-teal-700',
    softBg: 'bg-teal-50/70 dark:bg-teal-950/25',
  },
  {
    bar: 'border-l-indigo-500',
    ring: 'border-indigo-300 dark:border-indigo-700',
    softBg: 'bg-indigo-50/70 dark:bg-indigo-950/25',
  },
]

function hashPolicyId(policyId: string): number {
  let h = 0
  for (let i = 0; i < policyId.length; i++) {
    h = (h * 31 + policyId.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function policyCardTone(opts: {
  kind: 'builtin' | 'custom' | 'adhoc'
  builtinId?: BrainQueryBuiltinPolicyId
  colorIndex?: number
  policyId: string
}): PolicyCardTone {
  if (opts.kind === 'builtin' && opts.builtinId) {
    return builtinTones[opts.builtinId]
  }
  const idx =
    opts.kind === 'custom'
      ? (opts.colorIndex ?? 0)
      : hashPolicyId(opts.policyId)
  return customRotation[idx % customRotation.length]!
}
