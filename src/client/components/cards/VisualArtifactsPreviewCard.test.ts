import { describe, it, expect, vi } from 'vitest'
import VisualArtifactsPreviewCard from './VisualArtifactsPreviewCard.svelte'
import { render, screen, fireEvent } from '@client/test/render.js'
import type { VisualArtifact } from '@shared/visualArtifacts.js'

function mailArtifact(overrides: Partial<VisualArtifact>): VisualArtifact {
  return {
    kind: 'image',
    mime: 'image/png',
    ref: 'artifact-ref',
    label: 'artifact.png',
    origin: {
      kind: 'mailAttachment',
      messageId: 'message-1',
      attachmentIndex: 1,
      filename: 'artifact.png',
    },
    readStatus: 'available',
    ...overrides,
  }
}

describe('VisualArtifactsPreviewCard.svelte', () => {
  it('renders an available image artifact from the artifact endpoint', () => {
    render(VisualArtifactsPreviewCard, {
      props: {
        artifacts: [mailArtifact({ label: 'chart.png', ref: 'image ref' })],
      },
    })

    const image = screen.getByRole('img', { name: 'chart.png' })
    expect(image).toHaveAttribute('src', '/api/files/artifact?ref=image%20ref')
    expect(screen.queryByText('chart.png')).not.toBeInTheDocument()
  })

  it('opens image artifacts through the provided callback', async () => {
    const onOpenVisualArtifact = vi.fn()
    render(VisualArtifactsPreviewCard, {
      props: {
        artifacts: [mailArtifact({ label: 'chart.png', ref: 'image-ref' })],
        onOpenVisualArtifact,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Open image preview: chart.png' }))

    expect(onOpenVisualArtifact).toHaveBeenCalledWith('image-ref', 'chart.png')
  })

  it('renders an available PDF artifact as an accessible new-tab link', () => {
    render(VisualArtifactsPreviewCard, {
      props: {
        artifacts: [
          mailArtifact({
            kind: 'pdf',
            mime: 'application/pdf',
            label: 'report.pdf',
            ref: 'pdf-ref',
          }),
        ],
      },
    })

    const link = screen.getByRole('link', { name: 'Open PDF preview: report.pdf' })
    expect(link).toHaveAttribute('href', '/api/files/artifact?ref=pdf-ref')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveTextContent('PDF')
  })

  it('renders fallback text for an oversized artifact', () => {
    render(VisualArtifactsPreviewCard, {
      props: {
        artifacts: [
          mailArtifact({
            label: 'huge-scan.pdf',
            kind: 'pdf',
            mime: 'application/pdf',
            readStatus: 'too_large',
            size: 30 * 1024 * 1024,
          }),
        ],
      },
    })

    expect(screen.getByText('huge-scan.pdf is too large to preview.')).toBeInTheDocument()
  })
})
