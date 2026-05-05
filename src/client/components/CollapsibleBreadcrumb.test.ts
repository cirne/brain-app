import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import CollapsibleBreadcrumb from './CollapsibleBreadcrumb.svelte'

describe('CollapsibleBreadcrumb', () => {
  beforeEach(() => {
    // Mock ResizeObserver as a class
    global.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(_callback: ResizeObserverCallback) {
        // no-op
      }
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders root label when items array is empty', () => {
    render(CollapsibleBreadcrumb, { props: { items: [], rootLabel: 'My Wiki' } })
    expect(screen.getByText('My Wiki')).toBeTruthy()
  })

  it('renders all breadcrumb items when not overflowing', () => {
    const items = [
      { label: 'My Wiki', onClick: vi.fn(), isCurrent: false },
      { label: 'Projects', onClick: vi.fn(), isCurrent: false },
      { label: 'README.md', isCurrent: true },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })
    
    expect(screen.getByText('My Wiki')).toBeTruthy()
    expect(screen.getByText('Projects')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows current item without onClick as non-interactive', () => {
    const items = [
      { label: 'My Wiki', onClick: vi.fn(), isCurrent: false },
      { label: 'Current.md', isCurrent: true },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })
    
    const currentItem = screen.getByText('Current.md')
    expect(currentItem.tagName).not.toBe('BUTTON')
  })

  it('calls onClick when clicking interactive breadcrumb item', async () => {
    const onClickMock = vi.fn()
    const items = [
      { label: 'My Wiki', onClick: onClickMock, isCurrent: false },
      { label: 'Current.md', isCurrent: true },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })
    
    const button = screen.getByText('My Wiki')
    await fireEvent.click(button)
    
    expect(onClickMock).toHaveBeenCalledOnce()
  })

  it('includes separators between items', () => {
    const items = [
      { label: 'My Wiki', onClick: vi.fn(), isCurrent: false },
      { label: 'Folder', onClick: vi.fn(), isCurrent: false },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })
    
    const separators = screen.getAllByText('/')
    expect(separators.length).toBeGreaterThan(0)
  })

  it('applies mobile panel styling when mobilePanel prop is true', () => {
    const items = [{ label: 'Test', isCurrent: true }]
    const { container } = render(CollapsibleBreadcrumb, {
      props: { items, mobilePanel: true },
    })
    
    // Check for mobile-specific classes
    const breadcrumbText = screen.getByText('Test')
    expect(breadcrumbText.className).toContain('shrink-0')
  })
})
