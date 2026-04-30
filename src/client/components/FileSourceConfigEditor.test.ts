import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import FileSourceConfigEditor from './FileSourceConfigEditor.svelte'

describe('FileSourceConfigEditor.svelte', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders Drive warning when there are no roots', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))) as typeof fetch,
    )

    render(FileSourceConfigEditor, {
      props: {
        sourceId: 'gd',
        sourceKind: 'googleDrive',
        fileSource: {
          roots: [],
          includeGlobs: [],
          ignoreGlobs: [],
          maxFileBytes: 10_000_000,
          respectGitignore: true,
        },
        onSaved: () => {},
      },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/No Drive folders selected/)
  })

  it('calls onSaved after successful save', async () => {
    const onSaved = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const u = String(url)
        if (u.includes('/api/hub/sources/update-file-source') && init?.method === 'POST') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch,
    )

    render(FileSourceConfigEditor, {
      props: {
        sourceId: 'ld',
        sourceKind: 'localDir',
        fileSource: {
          roots: [{ id: '/tmp/x', name: 'x', recursive: true }],
          includeGlobs: [],
          ignoreGlobs: [],
          maxFileBytes: 10_000_000,
          respectGitignore: true,
        },
        onSaved,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /Save file source settings/i }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
  })
})
