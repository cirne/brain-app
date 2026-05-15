import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import { render, screen, waitFor, fireEvent, within } from '@client/test/render.js'
import PolicyDetailPage from './PolicyDetailPage.svelte'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import { resetBrainQueryBuiltinPolicyBodiesCacheForTests } from '@client/lib/brainQueryBuiltinPolicyBodiesApi.js'

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

const diskBuiltinBodies = getBuiltinPolicyBodiesFromDisk()

function builtinPolicyBodiesOk() {
  return Promise.resolve(new Response(JSON.stringify({ bodies: diskBuiltinBodies }), { status: 200 }))
}

describe('PolicyDetailPage.svelte', () => {
  const trustedBody = getBuiltinPolicyBodiesFromDisk().trusted
  const trustedGrant = {
    id: 'g1',
    ownerId: 'o1',
    ownerHandle: 'me',
    askerId: 'a1',
    askerHandle: 'coleague',
    privacyPolicy: trustedBody,
    presetPolicyKey: 'trusted',
    customPolicyId: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  }

  beforeEach(() => {
    localStorage.clear()
    resetBrainQueryBuiltinPolicyBodiesCacheForTests()
    const diskBodies = getBuiltinPolicyBodiesFromDisk()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const u = reqUrl(input)
        if (u.includes('/api/brain-query/builtin-policy-bodies')) {
          return Promise.resolve(new Response(JSON.stringify({ bodies: diskBodies }), { status: 200 }))
        }
        if (u.includes('/api/brain-query/policies') && (!init?.method || init.method === 'GET')) {
          return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
        }
        if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
          return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [trustedGrant] }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetBrainQueryBuiltinPolicyBodiesCacheForTests()
  })

  it('standard preset: shows fixed policy text and read-only note; no Edit control', async () => {
    render(PolicyDetailPage, {
      props: {
        policyId: 'trusted',
        onSettingsNavigate: vi.fn(),
        onBackToBrainAccessList: vi.fn(),
      },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.getByText(/standard preset/i)).toBeInTheDocument()
    expect(screen.getByText(/Preset deny list/i)).toBeInTheDocument()
  })

  it('custom bqc policy: Edit shows title + body; save PATCHes title and text', async () => {
    const customId = 'bqc_detail_edit_test'
    const customText = 'custom-body-for-edit-test'
    const fetchSpy = vi.mocked(fetch)
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const u = reqUrl(input)
      if (u.includes('/api/brain-query/builtin-policy-bodies')) {
        return builtinPolicyBodiesOk()
      }
      if (u.includes('/api/brain-query/policies') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              policies: [
                {
                  id: customId,
                  ownerId: 'o1',
                  title: 'Original title',
                  body: customText,
                  createdAtMs: 1,
                  updatedAtMs: 1,
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [] }), { status: 200 }))
      }
      if (
        u.includes(`/api/brain-query/policies/${encodeURIComponent(customId)}`) &&
        init?.method === 'PATCH'
      ) {
        return Promise.resolve(new Response('{}', { status: 200 }))
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
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    const titleInput = screen.getByPlaceholderText(/executive team/i)
    expect(titleInput).toHaveValue('Original title')
    const box = document.querySelector('#policy-text-draft') as HTMLTextAreaElement
    expect(box).toHaveValue(customText)

    await fireEvent.input(titleInput, { target: { value: 'Renamed policy' } })
    await fireEvent.input(box, { target: { value: 'updated body content' } })
    await tick()
    await fireEvent.click(screen.getByRole('button', { name: /^save policy$/i }))

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/brain-query/policies/${encodeURIComponent(customId)}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Renamed policy', body: 'updated body content' }),
        }),
      ),
    )
  })

  describe('zero grants', () => {
    const CUSTOM_KEY = 'brain.brainAccess.customPolicies.v1'

    beforeEach(() => {
      localStorage.removeItem(CUSTOM_KEY)
      resetBrainQueryBuiltinPolicyBodiesCacheForTests()
      vi.mocked(fetch).mockImplementation(
        ((input: RequestInfo | URL, init?: RequestInit) => {
          const u = reqUrl(input)
          if (u.includes('/api/brain-query/builtin-policy-bodies')) {
            return builtinPolicyBodiesOk()
          }
          if (u.includes('/api/brain-query/policies') && (!init?.method || init.method === 'GET')) {
            return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
          }
          if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
            return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [] }), { status: 200 }))
          }
          return Promise.resolve(new Response('not found', { status: 404 }))
        }) as typeof fetch,
      )
    })

    it('trusted preset: still read-only with zero grants', async () => {
      render(PolicyDetailPage, {
        props: {
          policyId: 'trusted',
          onSettingsNavigate: vi.fn(),
          onBackToBrainAccessList: vi.fn(),
        },
      })

      await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled())
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    })

    it('custom local: save updates title + text in localStorage', async () => {
      const fetchSpy = vi.mocked(fetch)
      const customId = 'custom:zero-grants-pol'
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
      const titleEl = screen.getByPlaceholderText(/executive team/i)
      await fireEvent.input(titleEl, { target: { value: 'Renamed local' } })
      const ta = document.querySelector('#policy-text-draft') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: 'updated-custom-body-abc-123' } })
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /^save policy$/i }))

      await waitFor(() => expect(screen.queryByPlaceholderText(/executive team/i)).not.toBeInTheDocument())

      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/brain-query\/grants\/[^/]+$/),
        expect.objectContaining({ method: 'PATCH' }),
      )
      const stored = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as { text: string; name: string }[]
      expect(stored[0]?.text).toBe('updated-custom-body-abc-123')
      expect(stored[0]?.name).toBe('Renamed local')
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
      expect(within(dialog).getByRole('heading', { name: /delete this policy\?/i })).toBeInTheDocument()
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
    const customId = 'bqc_with_grant_collab_test'
    const customText = 'custom-text-with-grant'

    const grantOnCustom = {
      id: 'gc',
      ownerId: 'o1',
      ownerHandle: 'me',
      askerId: 'a1',
      askerHandle: 'coleague',
      privacyPolicy: customText,
      presetPolicyKey: null,
      customPolicyId: customId,
      createdAtMs: 1,
      updatedAtMs: 1,
    }

    const fetchSpy = vi.mocked(fetch)
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const u = reqUrl(input)
      if (u.includes('/api/brain-query/builtin-policy-bodies')) {
        return builtinPolicyBodiesOk()
      }
      if (u.includes('/api/brain-query/policies') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              policies: [
                {
                  id: customId,
                  ownerId: 'o1',
                  title: 'With grant',
                  body: customText,
                  createdAtMs: 1,
                  updatedAtMs: 1,
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
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
