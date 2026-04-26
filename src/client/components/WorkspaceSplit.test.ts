import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@client/test/render.js'
import WorkspaceSplitHarness from './test-stubs/WorkspaceSplitHarness.svelte'

class MockResizeObserver {
  private callback: ResizeObserverCallback
  private elements: Set<Element> = new Set()
  static instances: MockResizeObserver[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe(el: Element) {
    this.elements.add(el)
  }

  unobserve(el: Element) {
    this.elements.delete(el)
  }

  disconnect() {
    this.elements.clear()
  }

  trigger(width = 800) {
    const entries = Array.from(this.elements).map((target) => ({
      target,
      contentRect: { width, height: 600 } as DOMRectReadOnly,
      borderBoxSize: [] as ResizeObserverSize[],
      contentBoxSize: [] as ResizeObserverSize[],
      devicePixelContentBoxSize: [] as ResizeObserverSize[],
    }))
    this.callback(entries, this)
  }

  static reset() {
    MockResizeObserver.instances = []
  }
}

describe('WorkspaceSplit.svelte', () => {
  beforeEach(() => {
    MockResizeObserver.reset()
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    })
  })

  it('renders with chat pane only when detail is closed', () => {
    render(WorkspaceSplitHarness, {
      props: {
        hasDetail: false,
        desktopDetailOpen: false,
      },
    })

    expect(screen.getByTestId('chat-pane-content')).toHaveTextContent('Chat Content')
    expect(screen.queryByTestId('detail-pane-content')).not.toBeInTheDocument()
  })

  it('renders both panes when desktopDetailOpen is true', () => {
    render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
      },
    })

    expect(screen.getByTestId('chat-pane-content')).toHaveTextContent('Chat Content')
    expect(screen.getByTestId('detail-pane-content')).toHaveTextContent('Detail Content')
  })

  it('applies has-detail class when hasDetail is true', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: false,
      },
    })

    const split = container.querySelector('.split')
    expect(split).toHaveClass('has-detail')
  })

  it('does not have has-detail class when hasDetail is false', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: false,
        desktopDetailOpen: false,
      },
    })

    const split = container.querySelector('.split')
    expect(split).not.toHaveClass('has-detail')
  })

  it('shows resize handle when detail is open and not fullscreen', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: false,
      },
    })

    const handle = container.querySelector('.detail-resize-handle')
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-label', 'Resize detail panel')
  })

  it('hides resize handle when detail is fullscreen', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: true,
      },
    })

    const handle = container.querySelector('.detail-resize-handle')
    expect(handle).not.toBeInTheDocument()
  })

  it('applies detail-fullscreen class when detailFullscreen is true and detail open', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: true,
      },
    })

    const split = container.querySelector('.split')
    expect(split).toHaveClass('detail-fullscreen')
  })

  it('toggleDetailFullscreen toggles state on desktop', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    })

    const { container, component } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: false,
      },
    })

    const split = container.querySelector('.split')
    expect(split).not.toHaveClass('detail-fullscreen')

    const inner = component.getComponent()
    inner?.toggleDetailFullscreen()
    await vi.advanceTimersByTimeAsync(0)

    expect(split).toHaveClass('detail-fullscreen')
  })

  it('toggleDetailFullscreen is no-op on mobile viewport', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 600,
    })

    const { container, component } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: false,
      },
    })

    const split = container.querySelector('.split')
    expect(split).not.toHaveClass('detail-fullscreen')

    const inner = component.getComponent()
    inner?.toggleDetailFullscreen()
    await vi.advanceTimersByTimeAsync(0)

    expect(split).not.toHaveClass('detail-fullscreen')
  })

  it('closeDesktopAnimated does nothing when detail not open', () => {
    const onNavigateClear = vi.fn()
    const { component } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: false,
        desktopDetailOpen: false,
        onNavigateClear,
      },
    })

    const inner = component.getComponent()
    inner?.closeDesktopAnimated()
    expect(onNavigateClear).not.toHaveBeenCalled()
  })

  it('closeDesktopAnimated calls onNavigateClear immediately with reduced motion', async () => {
    const onNavigateClear = vi.fn()

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    const { component } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        onNavigateClear,
      },
    })

    await vi.advanceTimersByTimeAsync(50)

    const inner = component.getComponent()
    inner?.closeDesktopAnimated()

    expect(onNavigateClear).toHaveBeenCalledTimes(1)
  })

  it('has correct DOM structure', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
      },
    })

    const workspace = container.querySelector('.workspace')
    expect(workspace).toBeInTheDocument()

    const split = container.querySelector('.split')
    expect(split).toBeInTheDocument()

    const chatPane = container.querySelector('.chat-pane')
    expect(chatPane).toBeInTheDocument()

    const detailPane = container.querySelector('.detail-pane')
    expect(detailPane).toBeInTheDocument()
  })

  it('chat pane has hidden class when fullscreen and detail open', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: true,
      },
    })

    const chatPane = container.querySelector('.chat-pane')
    expect(chatPane).toHaveClass('chat-pane-hidden')

    const detailPane = container.querySelector('.detail-pane')
    expect(detailPane).toHaveClass('detail-pane-fullscreen')
  })

  it('resize handle has grip element', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
      },
    })

    const handle = container.querySelector('.detail-resize-handle')
    expect(handle).toBeInTheDocument()

    const grip = handle?.querySelector('.detail-resize-grip')
    expect(grip).toBeInTheDocument()
    expect(grip).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders custom chat and detail text', () => {
    render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        chatText: 'Custom Chat',
        detailText: 'Custom Detail',
      },
    })

    expect(screen.getByTestId('chat-pane-content')).toHaveTextContent('Custom Chat')
    expect(screen.getByTestId('detail-pane-content')).toHaveTextContent('Custom Detail')
  })

  it('detail pane width is set via style when not fullscreen', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: false,
      },
    })

    const detailPane = container.querySelector('.detail-pane') as HTMLElement
    expect(detailPane).toBeInTheDocument()
    expect(detailPane.style.width).toBeDefined()
  })

  it('detail pane has no inline width when fullscreen', () => {
    const { container } = render(WorkspaceSplitHarness, {
      props: {
        hasDetail: true,
        desktopDetailOpen: true,
        detailFullscreen: true,
      },
    })

    const detailPane = container.querySelector('.detail-pane') as HTMLElement
    expect(detailPane).toBeInTheDocument()
    expect(detailPane.style.width).toBe('')
  })
})
