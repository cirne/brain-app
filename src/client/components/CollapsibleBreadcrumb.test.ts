import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import CollapsibleBreadcrumb from './CollapsibleBreadcrumb.svelte'

describe('CollapsibleBreadcrumb', () => {
  const openPathMenu = () => screen.getByRole('button', { name: /show full path/i })

  it('renders root label when items array is empty', () => {
    render(CollapsibleBreadcrumb, { props: { items: [], rootLabel: 'My Wiki' } })
    expect(screen.getByText('My Wiki')).toBeTruthy()
  })

  it('uses compact row: folder trigger plus current leaf when path has hierarchy', async () => {
    const items = [
      { label: 'My Wiki', onClick: vi.fn(), isCurrent: false, menuIcon: { kind: 'book-open' as const } },
      { label: 'Projects', onClick: vi.fn(), isCurrent: false, menuIcon: { kind: 'dir' as const, key: 'projects' } },
      { label: 'README.md', isCurrent: true },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })

    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'My Wiki' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Projects' })).toBeNull()

    await fireEvent.click(openPathMenu())
    const row = screen.getByRole('menuitem', { name: 'My Wiki' })
    expect(row.querySelector('svg')).toBeTruthy()
    await fireEvent.click(row)
    expect(items[0]!.onClick).toHaveBeenCalledOnce()

    await fireEvent.click(openPathMenu())
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Projects' }))
    expect(items[1]!.onClick).toHaveBeenCalledOnce()
  })

  it('shows current item without onClick as non-interactive leaf', async () => {
    const items = [{ label: 'My Wiki', onClick: vi.fn(), isCurrent: false }, { label: 'Current.md', isCurrent: true }]
    render(CollapsibleBreadcrumb, { props: { items } })

    const currentItem = screen.getByText('Current.md')
    expect(currentItem.tagName).not.toBe('BUTTON')

    await fireEvent.click(openPathMenu())
    const menuRoot = screen.getByRole('menuitem', { name: 'My Wiki' })
    expect(menuRoot.tagName).toBe('BUTTON')
  })

  it('includes separator between folder control and current segment', () => {
    const items = [
      { label: 'My Wiki', onClick: vi.fn(), isCurrent: false },
      { label: 'Folder', onClick: vi.fn(), isCurrent: false },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })

    expect(screen.getAllByText('/').length).toBeGreaterThanOrEqual(1)
  })

  it('applies mobile panel styling when mobilePanel prop is true', () => {
    const items = [{ label: 'Test', isCurrent: true }]
    render(CollapsibleBreadcrumb, { props: { items, mobilePanel: true } })

    const breadcrumbText = screen.getByText('Test')
    expect(breadcrumbText.className).toContain('shrink-0')
  })

  it('ellipsis tail on desktop for long filename in compact row', () => {
    const items = [
      { label: 'Wiki', onClick: vi.fn(), isCurrent: false },
      { label: 'palau-fall-presidents-conference-2026.md', isCurrent: true },
    ]
    render(CollapsibleBreadcrumb, { props: { items } })

    const tail = screen.getByText('palau-fall-presidents-conference-2026.md')
    expect(tail.className).toContain('min-w-0')
    expect(tail.className).toContain('flex-1')
    expect(tail.className).toContain('text-ellipsis')
  })

  it('single segment renders inline without folder menu', () => {
    render(CollapsibleBreadcrumb, {
      props: { items: [{ label: 'My Wiki', isCurrent: true }] },
    })

    expect(screen.queryByRole('button', { name: /show full path/i })).toBeNull()
    expect(screen.getByText('My Wiki')).toBeTruthy()
  })
})
