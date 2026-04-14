import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AGENT_PANEL_WIDTH_KEY,
  AGENT_PANEL_WIDTH_KEY_V2,
  FALLBACK_DETAIL_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  defaultDetailPanelWidth,
  loadInitialDetailPanelWidth,
  maxAgentPanelWidth,
  clampAgentPanelWidth,
  nextPanelWidthAfterDrag,
  persistDetailPanelWidth,
} from './agentPanelWidth.js'

describe('AGENT_PANEL_WIDTH_KEY', () => {
  it('matches legacy storage key (not read for initial width)', () => {
    expect(AGENT_PANEL_WIDTH_KEY).toBe('brain-agent-panel-width')
  })
})

describe('AGENT_PANEL_WIDTH_KEY_V2', () => {
  it('is the only key used for persisted width after user resize', () => {
    expect(AGENT_PANEL_WIDTH_KEY_V2).toBe('brain-agent-panel-width-v2')
  })
})

function stubBrowserWidthAndStorage(innerWidth: number) {
  const store: Record<string, string> = {}
  const ls = {
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  } as Storage
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', {
    innerWidth,
    localStorage: ls,
  } as unknown as Window & typeof globalThis)
  return { store, ls }
}

describe('loadInitialDetailPanelWidth + persistDetailPanelWidth', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns fallback when window is undefined', () => {
    expect(loadInitialDetailPanelWidth()).toBe(FALLBACK_DETAIL_PANEL_WIDTH)
  })

  it('uses 50/50 when v2 key is absent (ignores legacy v1)', () => {
    stubBrowserWidthAndStorage(1256)
    globalThis.localStorage.setItem(AGENT_PANEL_WIDTH_KEY, '290')
    expect(loadInitialDetailPanelWidth()).toBe(628)
  })

  it('reads width from v2 after user has resized', () => {
    stubBrowserWidthAndStorage(1256)
    globalThis.localStorage.setItem(AGENT_PANEL_WIDTH_KEY_V2, '400')
    expect(loadInitialDetailPanelWidth()).toBe(400)
  })

  it('persistDetailPanelWidth writes v2', () => {
    stubBrowserWidthAndStorage(1200)
    persistDetailPanelWidth(450, 1200)
    expect(globalThis.localStorage.getItem(AGENT_PANEL_WIDTH_KEY_V2)).toBe('450')
  })
})

describe('maxAgentPanelWidth', () => {
  it('caps at 920', () => {
    expect(maxAgentPanelWidth(5000)).toBe(920)
  })

  it('uses viewport minus reserve with a floor at min width', () => {
    expect(maxAgentPanelWidth(800)).toBe(480)
    expect(maxAgentPanelWidth(600)).toBe(290)
  })

  it('never goes below min panel width via viewport formula', () => {
    expect(maxAgentPanelWidth(400)).toBe(290)
  })
})

describe('clampAgentPanelWidth', () => {
  it('clamps to min', () => {
    expect(clampAgentPanelWidth(10, 1200)).toBe(MIN_AGENT_PANEL_WIDTH)
  })

  it('clamps to max for viewport', () => {
    expect(clampAgentPanelWidth(2000, 1200)).toBe(maxAgentPanelWidth(1200))
  })

  it('rounds fractional values', () => {
    expect(clampAgentPanelWidth(333.7, 1200)).toBe(334)
  })

  it('passes through in-range values', () => {
    expect(clampAgentPanelWidth(400, 1200)).toBe(400)
  })
})

describe('nextPanelWidthAfterDrag', () => {
  it('widens panel when dragging left (smaller clientX)', () => {
    expect(nextPanelWidthAfterDrag(400, 100, 80, 1200)).toBe(420)
  })

  it('narrows panel when dragging right', () => {
    expect(nextPanelWidthAfterDrag(400, 100, 120, 1200)).toBe(380)
  })

  it('respects clamp at boundaries', () => {
    expect(nextPanelWidthAfterDrag(900, 0, -2000, 1200)).toBe(maxAgentPanelWidth(1200))
    expect(nextPanelWidthAfterDrag(300, 100, 1000, 1200)).toBe(MIN_AGENT_PANEL_WIDTH)
  })
})

describe('defaultDetailPanelWidth', () => {
  it('uses half the viewport when within clamp', () => {
    expect(defaultDetailPanelWidth(1280)).toBe(640)
    expect(defaultDetailPanelWidth(800)).toBe(400)
  })

  it('clamps to min when 50% would be narrower', () => {
    expect(defaultDetailPanelWidth(400)).toBe(MIN_AGENT_PANEL_WIDTH)
  })

  it('clamps to max for viewport', () => {
    const vw = 5000
    expect(defaultDetailPanelWidth(vw)).toBe(maxAgentPanelWidth(vw))
  })
})

describe('FALLBACK_DETAIL_PANEL_WIDTH', () => {
  it('is a sane SSR placeholder', () => {
    expect(FALLBACK_DETAIL_PANEL_WIDTH).toBeGreaterThanOrEqual(MIN_AGENT_PANEL_WIDTH)
  })
})
