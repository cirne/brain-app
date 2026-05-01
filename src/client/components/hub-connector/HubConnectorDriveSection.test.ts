import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import HubConnectorDriveSection from './HubConnectorDriveSection.svelte'

type FetchMock = (url: RequestInfo, init?: RequestInit) => Promise<Response>

function makeFetch(handler: FetchMock): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch
}

const EMPTY_FILE_SOURCE = {
  roots: [],
  includeGlobs: [],
  ignoreGlobs: [],
  maxFileBytes: 10_000_000,
  respectGitignore: true,
}

const FILE_SOURCE_WITH_FOLDERS = {
  roots: [
    { id: 'f1', name: 'Projects', recursive: true },
    { id: 'f2', name: 'Notes', recursive: false },
  ],
  includeGlobs: [],
  ignoreGlobs: ['*.tmp'],
  maxFileBytes: 10_000_000,
  respectGitignore: true,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HubConnectorDriveSection', () => {
  it('shows empty state CTAs when no folders configured', () => {
    vi.stubGlobal('fetch', makeFetch(async () => new Response('{}', { status: 200 })))
    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: EMPTY_FILE_SOURCE,
        includeSharedWithMe: false,
        onSaved: vi.fn(),
      },
    })

    expect(screen.getByText('Suggest folders with AI')).toBeTruthy()
    expect(screen.getByText('Browse folders')).toBeTruthy()
  })

  it('shows folder cards when folders are configured', () => {
    vi.stubGlobal('fetch', makeFetch(async () => new Response('{}', { status: 200 })))
    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: FILE_SOURCE_WITH_FOLDERS,
        includeSharedWithMe: false,
        onSaved: vi.fn(),
      },
    })

    expect(screen.getByText('Projects')).toBeTruthy()
    expect(screen.getByText('Notes')).toBeTruthy()
    expect(screen.getByText('Add folder')).toBeTruthy()
    expect(screen.queryByText('Suggest folders with AI')).toBeNull()
  })

  it('opens browser when Browse folders is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url) => {
        if (String(url).includes('browse-folders')) {
          return new Response(
            JSON.stringify({
              ok: true,
              folders: [{ id: 'gf1', name: 'Work', hasChildren: false }],
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 200 })
      }),
    )

    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: EMPTY_FILE_SOURCE,
        includeSharedWithMe: false,
        onSaved: vi.fn(),
      },
    })

    fireEvent.click(screen.getByText('Browse folders'))
    await waitFor(() => {
      expect(screen.getByText('Work')).toBeTruthy()
    })
  })

  it('opens suggestion panel and pre-selects included folders', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url) => {
        if (String(url).includes('suggest-drive-folders')) {
          return new Response(
            JSON.stringify({
              ok: true,
              suggestions: [
                { id: 'f1', name: 'Projects', reason: 'Work docs', include: true },
                { id: 'f2', name: 'Photos', reason: 'Media', include: false },
              ],
              ignoreGlobs: ['*.tmp'],
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 200 })
      }),
    )

    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: EMPTY_FILE_SOURCE,
        includeSharedWithMe: false,
        onSaved: vi.fn(),
      },
    })

    fireEvent.click(screen.getByText('Suggest folders with AI'))
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeTruthy()
      expect(screen.getByText('Projects')).toBeTruthy()
      expect(screen.getByText('Photos')).toBeTruthy()
      expect(screen.getByText(/Work docs/)).toBeTruthy()
    })

    // Apply button shows count of included suggestions
    expect(screen.getByText(/Apply 1 folder/)).toBeTruthy()
  })

  it('shows Advanced section toggle after folders are configured', () => {
    vi.stubGlobal('fetch', makeFetch(async () => new Response('{}', { status: 200 })))
    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: FILE_SOURCE_WITH_FOLDERS,
        includeSharedWithMe: false,
        onSaved: vi.fn(),
      },
    })

    expect(screen.getByText('Advanced')).toBeTruthy()
  })

  it('removes a folder and calls update-file-source', async () => {
    const onSaved = vi.fn()
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url) => {
        if (String(url).includes('update-file-source')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      }),
    )

    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: FILE_SOURCE_WITH_FOLDERS,
        includeSharedWithMe: false,
        onSaved,
      },
    })

    const removeBtn = screen.getByLabelText('Remove Projects')
    fireEvent.click(removeBtn)

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
    })
  })
})
