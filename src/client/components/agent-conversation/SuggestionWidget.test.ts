import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@client/test/render.js'
import SuggestionWidget from './SuggestionWidget.svelte'

describe('SuggestionWidget', () => {
  it('renders chip buttons for type chips', () => {
    const onSubmit = vi.fn()
    render(SuggestionWidget, {
      props: {
        suggestionSet: { type: 'chips', choices: [{ label: 'Yes', submit: 'Yes please' }] },
        onSubmit,
      },
    })
    const btn = screen.getByRole('button', { name: /Yes/i })
    expect(btn).toBeTruthy()
    btn.click()
    expect(onSubmit).toHaveBeenCalledWith('Yes please')
  })

  it('shows skeleton when loading and no set', () => {
    const { container } = render(SuggestionWidget, {
      props: { suggestionSet: null, loading: true },
    })
    expect(container.querySelector('.suggestion-widget__skeleton')).toBeTruthy()
  })
})
