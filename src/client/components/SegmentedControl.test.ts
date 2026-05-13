import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@client/test/render.js'
import SegmentedControl from './SegmentedControl.svelte'
import type { SegmentedOption } from '@client/lib/segmentedControl.js'

describe('SegmentedControl', () => {
  const options: SegmentedOption<'sm' | 'md' | 'lg'>[] = [
    { value: 'sm', label: 'Small', icon: 'type', iconSize: 12, testId: 'seg-sm' },
    { value: 'md', label: 'Medium', icon: 'type', iconSize: 14, testId: 'seg-md' },
    { value: 'lg', label: 'Large', icon: 'type', iconSize: 16, testId: 'seg-lg' },
  ]

  it('calls onValueChange and updates selection', async () => {
    const onValueChange = vi.fn()

    render(SegmentedControl, {
      props: {
        options,
        value: 'sm',
        groupLabel: 'Text size',
        onValueChange,
      },
    })

    const md = screen.getByTestId('seg-md')
    expect(md.getAttribute('aria-checked')).toBe('false')

    await fireEvent.click(md)
    expect(onValueChange).toHaveBeenCalledWith('md')
    expect(md.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('seg-sm').getAttribute('aria-checked')).toBe('false')
  })

  it('moves selection with ArrowRight', async () => {
    render(SegmentedControl, {
      props: {
        options,
        value: 'sm',
        groupLabel: 'Text size',
      },
    })

    const sm = screen.getByTestId('seg-sm')
    sm.focus()
    await fireEvent.keyDown(sm, { key: 'ArrowRight' })
    expect(screen.getByTestId('seg-md').getAttribute('aria-checked')).toBe('true')
  })
})
