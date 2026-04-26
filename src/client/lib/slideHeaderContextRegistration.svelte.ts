import { setContext } from 'svelte'

/** One setContext + register callback; read reactive state via `.current`. */
export function createSlideHeaderRegistration<T>(key: unknown) {
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
