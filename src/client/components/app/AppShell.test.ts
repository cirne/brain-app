import { describe, it, expect } from 'vitest'
import AppShellTestHarness from '@components/test-stubs/AppShellTestHarness.svelte'
import { render } from '@client/test/render.js'

describe('AppShell.svelte', () => {
  it('places sidebar beside the stacked top nav + workspace on desktop (`stackTopNavFirst` false)', () => {
    const { container } = render(AppShellTestHarness, { props: { stackTopNavFirst: false } })

    const app = container.querySelector('.app')
    expect(app?.classList.contains('flex-row')).toBe(true)

    const rail = container.querySelector('[data-testid="shell-sidebar"]')
    const stack = container.querySelector('.app-main-stack')

    expect(rail?.parentElement).toBe(app)
    expect(stack?.parentElement).toBe(app)
    expect([...app!.children].indexOf(rail!)).toBeLessThan([...app!.children].indexOf(stack!))

    const topNavSlot = stack?.querySelector('[data-testid="shell-top-nav"]')
    const workWrap = stack?.querySelector('.app-workspace')
    expect(topNavSlot?.parentElement).toBe(stack)
    expect(stack?.children[0]).toBe(topNavSlot)
    expect(workWrap?.querySelector('[data-testid="shell-workspace"]')).toBeTruthy()
  })

  it('keeps slide-over row under the top nav on narrow layout (`stackTopNavFirst` true)', () => {
    const { container } = render(AppShellTestHarness, { props: { stackTopNavFirst: true } })

    const app = container.querySelector('.app')
    expect(app?.classList.contains('flex-col')).toBe(true)

    const topNav = container.querySelector('[data-testid="shell-top-nav"]')
    const row = container.querySelector('.app-main-row')
    expect(topNav?.parentElement).toBe(app)
    expect(row?.parentElement).toBe(app)
    expect([...app!.children].indexOf(topNav!)).toBeLessThan([...app!.children].indexOf(row!))

    const rail = row?.querySelector('[data-testid="shell-sidebar"]')
    const workWrap = row?.querySelector('.app-workspace')
    expect(rail?.parentElement).toBe(row)
    expect(workWrap?.querySelector('[data-testid="shell-workspace"]')).toBeTruthy()
  })
})
