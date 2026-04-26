import { describe, it, expect } from 'vitest'
import OnboardingHeroShellHarness from '../test-stubs/OnboardingHeroShellHarness.svelte'
import { render, screen } from '@client/test/render.js'

describe('OnboardingHeroShell.svelte', () => {
  it('wraps children and sets aria-busy from props', () => {
    const { container } = render(OnboardingHeroShellHarness)
    expect(screen.getByTestId('hero-body')).toHaveTextContent('Hero body')
    const outer = container.querySelector('[aria-busy="true"]')
    expect(outer).toBeTruthy()
  })
})
