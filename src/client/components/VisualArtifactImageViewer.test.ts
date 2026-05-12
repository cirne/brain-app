import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import VisualArtifactImageViewer from './VisualArtifactImageViewer.svelte'

describe('VisualArtifactImageViewer.svelte', () => {
  it('renders artifact image and toggles sizing mode', async () => {
    render(VisualArtifactImageViewer, {
      props: {
        ref: 'va1.image ref',
        label: 'chart.png',
      },
    })

    const image = screen.getByRole('img', { name: 'chart.png' })
    expect(image).toHaveAttribute('src', '/api/files/artifact?ref=va1.image%20ref')
    expect(screen.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.click(screen.getByRole('button', { name: 'Actual size' }))

    expect(screen.getByRole('button', { name: 'Actual size' })).toHaveAttribute('aria-pressed', 'true')
    expect(image).toHaveClass('max-w-none')
  })
})
