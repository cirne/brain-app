import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import { render, screen, waitFor, fireEvent, within } from '@client/test/render.js'
import PolicyDetailPage from './PolicyDetailPage.svelte'
import { BRAIN_QUERY_POLICY_TEMPLATES } from '@client/lib/brainQueryPolicyTemplates.js'
import { loadBuiltinPolicyDraft } from '@client/lib/brainAccessBuiltinPolicyDrafts.js'

vi.mock('@client/lib/vaultClient.js', () => ({
  fetchVaultStatus: vi.fn(() =>
    Promise.resolve({
      unlocked: true,
      multiTenant: false,
    }),
  ),
}))

vi.mock('@client/lib/workspaceHandleSuggest.js', () => ({
  fetchWorkspaceHandleSuggestions: vi.fn((_q: string, token: number) =>
    Promise.resolve({ token, results: [] }),
  ),
}))

function reqUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('PolicyDetailPage.svelte', () => {
  const trustedBody = BRAIN_QUERY_POLICY_TEMPLATES[0]!.text
  const trustedGrant = {
    id: 'g1',
    ownerId: 'o1',
    ownerHandle: 'me',
    askerId: 'a1',
    askerHandle: 'coleague',
    privacyPolicy: trustedBody,
    createdAtMs: 1,
    updatedAtMs: 1,
  }

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const u = reqUrl(input)
        if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
          return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [trustedGrant] }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows inline editor with Save/Cancel after Edit — no modal', async () => {
    const onSettingsNavigate = vi.fn()
    const onBackToBrainAccessList = vi.fn()

    render(PolicyDetailPage, {
      props: {
        policyId: 'trusted',
        onSettingsNavigate,
        onBackToBrainAccessList,
      },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^save policy$/i })).toBeInTheDocument()

    expect(document.querySelector('[id="brain-policy-editor-title"]')).toBeNull()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue(trustedBody)
  })

  it('Cancel restores view mode without saving', async () => {
    const fetchSpy = vi.mocked(fetch)
    render(PolicyDetailPage, {
      props: {
        policyId: 'trusted',
        onSettingsNavigate: vi.fn(),
        onBackToBrainAccessList: vi.fn(),
      },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const box = screen.getByRole('textbox')
    await fireEvent.input(box, { target: { value: 'edited body' } })
    await tick()
    await fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument())
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/brain-query\/grants\/g1/),
      expect.objectContaining({ method: 'PATCH' }),
    )

    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByRole('textbox')).toHaveValue(trustedBody)
  })

  it('Save PATCHes grants, closes the editor, and navigates when text moves out of this bucket', async () => {
    const onSettingsNavigate = vi.fn()
    const fetchSpy = vi.mocked(fetch)
    const nextText = 'unique-short-inline-policy-marker-abc'
    const grantAfterSave = { ...trustedGrant, privacyPolicy: nextText }
    let getCount = 0
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const u = reqUrl(input)
      if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
        getCount += 1
        const body = getCount >= 2 ? [grantAfterSave] : [trustedGrant]
        return Promise.resolve(new Response(JSON.stringify({ grantedByMe: body }), { status: 200 }))
      }
      if (u.includes('/api/brain-query/grants/g1') && init?.method === 'PATCH') {
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    render(PolicyDetailPage, {
      props: {
        policyId: 'trusted',
        onSettingsNavigate,
        onBackToBrainAccessList: vi.fn(),
      },
    })
    await tick()

    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    await fireEvent.input(ta, { target: { value: nextText } })
    await tick()
    expect(ta.value).toBe(nextText)

    await fireEvent.click(screen.getByRole('button', { name: /^save policy$/i }))

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain-query/grants/g1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ privacyPolicy: nextText.trim() }),
        }),
      ),
    )

    await waitFor(() =>
      expect(onSettingsNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'brain-access-policy',
          policyId: expect.stringMatching(/^adhoc:[0-9a-f]+$/),
        }),
        { replace: true },
      ),
    )

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('zero grants', () => {
    const BUILTIN_DRAFT_KEY = 'brain.brainAccess.builtinPolicyDrafts.v1'
    const CUSTOM_KEY = 'brain.brainAccess.customPolicies.v1'

    beforeEach(() => {
      localStorage.removeItem(BUILTIN_DRAFT_KEY)
      localStorage.removeItem(CUSTOM_KEY)
      vi.mocked(fetch).mockImplementation(
        ((input: RequestInfo | URL, init?: RequestInit) => {
          const u = reqUrl(input)
          if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
            return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [] }), { status: 200 }))
          }
          return Promise.resolve(new Response('not found', { status: 404 }))
        }) as typeof fetch,
      )
    })

    it('trusted: Edit enabled; save persists builtin draft (no PATCH)', async () => {
      const fetchSpy = vi.mocked(fetch)
      const nextText = 'zero-grant-builtin-draft-marker-xyz'

      render(PolicyDetailPage, {
        props: {
          policyId: 'trusted',
          onSettingsNavigate: vi.fn(),
          onBackToBrainAccessList: vi.fn(),
        },
      })

      await waitFor(() => expect(screen.getByRole('button', { name: /^edit$/i })).not.toBeDisabled())
      await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: nextText } })
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /^save policy$/i }))

      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/brain-query\/grants\/[^/]+$/),
        expect.objectContaining({ method: 'PATCH' }),
      )
      expect(loadBuiltinPolicyDraft('trusted')).toBe(nextText)
    })

    it('custom: save updates localStorage (no PATCH)', async () => {
      const fetchSpy = vi.mocked(fetch)
      const customId = 'custom:zero-grants-pol'
      const nextText = 'updated-custom-body-abc-123'
      localStorage.setItem(
        CUSTOM_KEY,
        JSON.stringify([{ id: customId, name: 'Test policy', text: 'original', colorIndex: 0 }]),
      )

      render(PolicyDetailPage, {
        props: {
          policyId: customId,
          onSettingsNavigate: vi.fn(),
          onBackToBrainAccessList: vi.fn(),
        },
      })

      await waitFor(() => expect(screen.getByRole('button', { name: /^edit$/i })).not.toBeDisabled())
      await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: nextText } })
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /^save policy$/i }))

      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/brain-query\/grants\/[^/]+$/),
        expect.objectContaining({ method: 'PATCH' }),
      )
      const stored = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as { text: string }[]
      expect(stored[0]?.text).toBe(nextText)
    })

    it('custom: Delete policy confirms via dialog, clears localStorage, navigates back', async () => {
      const customId = 'custom:delete-me-test'
      localStorage.setItem(
        CUSTOM_KEY,
        JSON.stringify([{ id: customId, name: 'My saved policy', text: 'preset body', colorIndex: 0 }]),
      )
      const onBackToBrainAccessList = vi.fn()

      render(PolicyDetailPage, {
        props: {
          policyId: customId,
          onSettingsNavigate: vi.fn(),
          onBackToBrainAccessList,
        },
      })

      await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())

      await fireEvent.click(screen.getByRole('button', { name: /^delete policy$/i }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: /delete policy\?/i })).toBeInTheDocument()
      expect(within(dialog).getByText(/My saved policy/)).toBeInTheDocument()

      await fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

      await waitFor(() => expect(onBackToBrainAccessList).toHaveBeenCalled())
      expect(localStorage.getItem(CUSTOM_KEY)).toBe('[]')
    })
  })

  it('does not show Delete policy for built-in policies', async () => {
    render(PolicyDetailPage, {
      props: {
        policyId: 'trusted',
        onSettingsNavigate: vi.fn(),
        onBackToBrainAccessList: vi.fn(),
      },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: /^delete policy$/i })).not.toBeInTheDocument()
  })

  it('custom policy with collaborators disables Delete policy', async () => {
    const customKey = 'brain.brainAccess.customPolicies.v1'
    const customId = 'custom:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const customText = 'custom-text-with-grant'
    localStorage.setItem(
      customKey,
      JSON.stringify([{ id: customId, name: 'With grant', text: customText, colorIndex: 0 }]),
    )

    const grantOnCustom = {
      id: 'gc',
      ownerId: 'o1',
      ownerHandle: 'me',
      askerId: 'a1',
      askerHandle: 'coleague',
      privacyPolicy: customText,
      createdAtMs: 1,
      updatedAtMs: 1,
    }

    const fetchSpy = vi.mocked(fetch)
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const u = reqUrl(input)
      if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [grantOnCustom] }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    render(PolicyDetailPage, {
      props: {
        policyId: customId,
        onSettingsNavigate: vi.fn(),
        onBackToBrainAccessList: vi.fn(),
      },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())

    const del = screen.getByRole('button', { name: /delete policy/i })
    expect(del).toBeDisabled()
  })
})
