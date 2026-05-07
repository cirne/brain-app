import { setContext } from 'svelte'

export type SlideHeaderRegistration<T> = {
  get current(): T | null
  /** Increments on every {@link SlideHeaderRegistration.register} — read from `$derived.by` in parents so detail/header UI tracks nested `$state` updates. */
  get updateSeq(): number
  register: (_next: T | null) => void
}

/** One setContext + register callback; read reactive state via `.current`. */
export function createSlideHeaderRegistration<T>(key: unknown): SlideHeaderRegistration<T> {
  let current = $state<T | null>(null)
  let updateSeq = $state(0)
  function register(next: T | null) {
    current = next
    updateSeq += 1
  }
  setContext(key, register)
  return {
    get current() {
      return current
    },
    get updateSeq() {
      return updateSeq
    },
    register,
  }
}
