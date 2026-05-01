import { setContext } from 'svelte'

export type SlideHeaderRegistration<T> = {
  get current(): T | null
  register: (_next: T | null) => void
}

/** One setContext + register callback; read reactive state via `.current`. */
export function createSlideHeaderRegistration<T>(key: unknown): SlideHeaderRegistration<T> {
  let current = $state<T | null>(null)
  function register(next: T | null) {
    current = next
  }
  setContext(key, register)
  return {
    get current() {
      return current
    },
    register,
  }
}
