/** sessionStorage: user chose "Later" on the Full Disk Access gate (cleared on cold launch is implicit — session only). */
export const FDA_GATE_LATER_SESSION_KEY = 'brain_fda_gate_later'

/** Dispatch on `window` to re-open the FDA gate from degraded-mode UI. */
export const FDA_GATE_OPEN_EVENT = 'brain-open-fda-gate'
