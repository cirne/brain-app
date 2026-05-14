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
  it('shows empty state with browse when no folders configured', () => {
    vi.stubGlobal('fetch', makeFetch(async () => new Response('{}', { status: 200 })))
    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: EMPTY_FILE_SOURCE,
        includeSharedWithMe: false,
        onSaved: vi.fn(),
      },
    })

    expect(screen.getByText('Browse folders')).toBeTruthy()
    expect(screen.queryByText('Suggest folders with AI')).toBeNull()
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

  it('shows Advanced section toggle', () => {
    vi.stubGlobal('fetch', makeFetch(async () => new Response('{}', { status: 200 })))
    render(HubConnectorDriveSection, {
      props: {
        sourceId: 'drive_x',
        fileSource: EMPTY_FILE_SOURCE,
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
