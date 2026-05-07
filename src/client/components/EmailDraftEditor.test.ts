import { describe, it, expect, vi, afterEach } from 'vitest'
import EmailDraftEditor from './EmailDraftEditor.svelte'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import {
  EMAIL_DRAFT_HEADER,
  type EmailDraftHeaderCell,
  type EmailDraftHeaderActions,
} from '@client/lib/emailDraftSlideHeaderContext.js'
import { makeSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

vi.mock('./TipTapMarkdownEditor.svelte', () => import('./test-stubs/TipTapMarkdownEditorStub.svelte'))

describe('EmailDraftEditor.svelte', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const baseDraft = {
    id: 'd1',
    subject: 'Original',
    body: '# Hello\n\nWorld',
    to: ['x@y.com'],
    cc: [] as string[],
    bcc: [] as string[],
  }

  function mountFetchHandlers(handlers: { draft?: Record<string, unknown>; sendOk?: boolean } = {}) {
    const draft = handlers.draft ?? baseDraft
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString()
      const method = init?.method ?? 'GET'
      if (u.includes('/api/inbox/draft/d1/send') && method === 'POST') {
        const ok = handlers.sendOk !== false
        return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500 })
      }
      if (u.includes('/api/inbox/draft/d1') && method === 'PATCH') {
        const body = JSON.parse(init!.body as string) as Record<string, unknown>
        return new Response(JSON.stringify({ ...draft, ...body }), { status: 200 })
      }
      if (u.includes('/api/inbox/draft/d1')) {
        return new Response(JSON.stringify(draft), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  }

  it('loads draft and PATCHes on Save', async () => {
    mountFetchHandlers()
    const onContextChange = vi.fn()
    const { component } = render(EmailDraftEditor, {
      props: { draftId: 'd1', onContextChange },
    })

    await waitFor(() => {
      expect(screen.queryByText(/loading draft/i)).not.toBeInTheDocument()
    })

    expect(screen.getByLabelText(/^subject$/i)).toHaveValue('Original')

    await fireEvent.input(screen.getByLabelText(/^subject$/i), {
      target: { value: 'Updated subject' },
    })

    await component.saveDraft()

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    type FetchCall = [unknown, RequestInit?]

    await waitFor(() => {
      const patchCalls = (fetchMock.mock.calls as FetchCall[]).filter((c) => c[1]?.method === 'PATCH')
      expect(patchCalls.length).toBeGreaterThanOrEqual(1)
    })

    const patchCalls = (fetchMock.mock.calls as FetchCall[]).filter((c) => c[1]?.method === 'PATCH')
    const body = JSON.parse(patchCalls[patchCalls.length - 1]![1]!.body as string)
    expect(body.subject).toBe('Updated subject')
    expect(body.body).toContain('Hello')
    expect(onContextChange).toHaveBeenCalled()
  })

  it('shows load error when GET fails', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'gone' }), { status: 404 }),
    ) as typeof fetch

    render(EmailDraftEditor, { props: { draftId: 'd1' } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/gone/)
    })
  })

  it('POSTs send after PATCH succeeds', async () => {
    mountFetchHandlers()
    const { component } = render(EmailDraftEditor, { props: { draftId: 'd1' } })

    await waitFor(() => {
      expect(screen.queryByText(/loading draft/i)).not.toBeInTheDocument()
    })

    await component.sendDraft()

    const sendFetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await waitFor(() => {
      const calls = (sendFetchMock.mock.calls as [unknown, RequestInit?][]).map((c) => c[1]?.method ?? 'GET')
      expect(calls.filter((m) => m === 'PATCH').length).toBeGreaterThanOrEqual(1)
      expect(calls.filter((m) => m === 'POST').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('claims the email draft header cell once and keeps stable handler refs across saves', async () => {
    mountFetchHandlers()

    const cell: EmailDraftHeaderCell = makeSlideHeaderCell<EmailDraftHeaderActions>()
    const context = new Map<symbol, EmailDraftHeaderCell>([[EMAIL_DRAFT_HEADER, cell]])

    const { component } = render(EmailDraftEditor, {
      props: { draftId: 'd1' },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })

    expect(cell.current?.saveState).toBe('idle')
    expect(cell.current?.sendState).toBe('idle')
    const onSaveRef = cell.current?.onSave
    const onSendRef = cell.current?.onSend
    const onDiscardRef = cell.current?.onDiscard
    expect(typeof onSaveRef).toBe('function')

    await component.saveDraft()

    // After save, the cell still has the same handler identities — only `saveState` patches.
    await waitFor(() => {
      expect(cell.current?.onSave).toBe(onSaveRef)
    })
    expect(cell.current?.onSend).toBe(onSendRef)
    expect(cell.current?.onDiscard).toBe(onDiscardRef)
  })

  it('calls onClosePanel after send succeeds', async () => {
    mountFetchHandlers()
    const onClosePanel = vi.fn()
    const { component } = render(EmailDraftEditor, {
      props: { draftId: 'd1', onClosePanel },
    })

    await waitFor(() => {
      expect(screen.queryByText(/loading draft/i)).not.toBeInTheDocument()
    })

    await component.sendDraft()

    await waitFor(() => {
      expect(onClosePanel).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText(/^sent!$/i)).not.toBeInTheDocument()
  })
})
