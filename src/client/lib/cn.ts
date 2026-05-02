import type { ClassValue } from 'svelte/elements'
import { twMerge } from 'tailwind-merge'

type ClassDictionary = Record<string, unknown>
type ClassArray = ClassInput[]
export type ClassInput = ClassValue | ClassDictionary | ClassArray | false | null | undefined

function flattenClass(input: ClassInput, out: string[]) {
  if (!input) return

  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'bigint') {
    out.push(String(input))
    return
  }

  if (Array.isArray(input)) {
    for (const value of input) flattenClass(value, out)
    return
  }

  if (typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (value) out.push(key)
    }
  }
}

export function cn(...inputs: ClassInput[]) {
  const classes: string[] = []
  for (const input of inputs) flattenClass(input, classes)
  return twMerge(classes.join(' '))
}
