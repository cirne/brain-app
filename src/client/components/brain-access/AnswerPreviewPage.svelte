<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, Users } from 'lucide-svelte'
  import {
    loadBrainAccessCustomPolicies,
    type BrainAccessCustomPolicy,
  } from '@client/lib/brainAccessCustomPolicies.js'
  import {
    loadBuiltinPolicyDraft,
  } from '@client/lib/brainAccessBuiltinPolicyDrafts.js'
  import {
    buildPolicyCardModels,
    grantsMatchingPolicyId,
    type BrainAccessGrantRow,
  } from '@client/lib/brainAccessPolicyGrouping.js'
  import { parseBrainQueryFilterNotes } from '@client/lib/brainQueryFilterNotes.js'
  import { consumeAgentChatStream } from '@client/lib/agentChat/streamClient.js'
  import type { ChatMessage } from '@client/lib/agentUtils.js'
  import {
    cloneChatMessagesSnapshot,
    extractBrainQueryEarlyRejectionFromChatMessages,
    lastAssistantPlainTextFromMessages,
  } from '@client/lib/agentUtils.js'
  import { readChatToolDisplayPreference } from '@client/lib/chatToolDisplayPreference.js'
  import AgentConversation from '@components/agent-conversation/AgentConversation.svelte'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import type { ConversationScrollApi } from '@client/lib/agentConversationViewTypes.js'
  import BrainAccessBreadcrumbs from './BrainAccessBreadcrumbs.svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'

  type Props = {
    policyId: string
    onBackToBrainAccessList: () => void
    onBackToPolicy: () => void
    onNavigateToSettingsRoot: () => void
  }

  let props: Props = $props()
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let grantedByMe = $state<BrainAccessGrantRow[]>([])
  let customPolicies = $state<BrainAccessCustomPolicy[]>([])

  /** Bumps when starting a new preview (transcript cleared on each submit). */
  let composerSessionKey = $state(0)
  let workingMessages = $state<ChatMessage[]>([])
  let streaming = $state(false)
  /** `research` = SSE in flight; `filter` = second hop */
  let phase = $state<'idle' | 'research' | 'filter'>('idle')

  type CompletedTurn = {
    question: string
    draftAnswer: string
    returnedToCollaborator: string
    filterNotes: string | null
    status: 'ok' | 'filter_blocked' | 'early_rejected'
    /** Full research-phase transcript (same payload as live {@link workingMessages} before filter). */
    researchMessages: ChatMessage[]
  }

  let completedTurns = $state<CompletedTurn[]>([])
  let genericError = $state<string | null>(null)

  let conversationEl: ConversationScrollApi | undefined = $state(undefined)
  let abortController: AbortController | null = null

  const toolDisplayMode = readChatToolDisplayPreference()

  function parseGrants(json: unknown): BrainAccessGrantRow[] | null {
    if (!json || typeof json !== 'object') return null
    const o = json as Record<string, unknown>
    const a = o.grantedByMe
    if (!Array.isArray(a)) return null
    const map = (x: unknown): BrainAccessGrantRow | null => {
      if (!x || typeof x !== 'object') return null
      const r = x as Record<string, unknown>
      if (
        typeof r.id !== 'string' ||
        typeof r.ownerId !== 'string' ||
        typeof r.ownerHandle !== 'string' ||
        typeof r.askerId !== 'string' ||
        typeof r.privacyPolicy !== 'string' ||
        typeof r.createdAtMs !== 'number' ||
        typeof r.updatedAtMs !== 'number'
      ) {
        return null
      }
      const askerHandle = typeof r.askerHandle === 'string' ? r.askerHandle : undefined
      return {
        id: r.id,
        ownerId: r.ownerId,
        ownerHandle: r.ownerHandle,
        askerId: r.askerId,
        ...(askerHandle ? { askerHandle } : {}),
        privacyPolicy: r.privacyPolicy,
        createdAtMs: r.createdAtMs,
        updatedAtMs: r.updatedAtMs,
      }
    }
    return a.map(map).filter((x): x is BrainAccessGrantRow => x !== null)
  }

  async function reload(): Promise<void> {
    loadError = null
    busy = true
    const customs = loadBrainAccessCustomPolicies()
    customPolicies = customs
    try {
      const gRes = await fetch('/api/brain-query/grants')
      if (!gRes.ok) {
        loadError = (await gRes.text()) || 'Failed to load grants.'
        return
      }
      const rows = parseGrants(await gRes.json())
      if (!rows) {
        loadError = 'Invalid grants response.'
        return
      }
      grantedByMe = rows
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  onMount(() => {
    void reload()
  })

  const cardModels = $derived(buildPolicyCardModels(grantedByMe, customPolicies))
  const card = $derived(cardModels.find((c) => c.policyId === props.policyId))

  const policyLabel = $derived(card?.label ?? 'Policy')

  const grantsInPolicy = $derived(grantsMatchingPolicyId(grantedByMe, customPolicies, props.policyId))

  const activeQuestionPreview = $derived(
    workingMessages.length > 0 && workingMessages[0]?.role === 'user'
      ? (workingMessages[0].content ?? '').trim()
      : '',
  )

  const hasPreviewTranscript = $derived(completedTurns.length > 0 || workingMessages.length > 0)

  const previewComposerPlaceholder = $derived(
    hasPreviewTranscript
      ? 'Ask another question to compare responses'
      : 'Ask something a collaborator might ask about your vault or mail.',
  )

  const canonicalPrivacyPolicy = $derived.by(() => {
    if (grantsInPolicy.length > 0) {
      return card?.canonicalText ?? grantsInPolicy[0]?.privacyPolicy ?? ''
    }
    if (card?.kind === 'builtin') {
      const draft = loadBuiltinPolicyDraft(props.policyId)
      if (draft !== undefined) return draft
    }
    return card?.canonicalText ?? ''
  })

  function touchWorkingMessages() {
    workingMessages = [...workingMessages]
  }

  async function runPreviewTurn(question: string): Promise<void> {
    genericError = null
    const policyText = canonicalPrivacyPolicy.trim()
    if (!policyText) {
      genericError = 'Save your policy text before previewing.'
      return
    }

    completedTurns = []
    composerSessionKey += 1

    phase = 'research'
    streaming = true
    workingMessages = [
      { role: 'user', content: question },
      { role: 'assistant', content: '', parts: [] },
    ]

    abortController?.abort()
    abortController = new AbortController()
    const ac = abortController
    const msgIdx = 1

    const tz =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
        : 'UTC'

    try {
      const res = await fetch('/api/brain-query/preview/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: question, timezone: tz, privacyPolicy: policyText }),
        signal: ac.signal,
      })

      if (!res.ok) {
        genericError = `Preview couldn’t run. Try again. (${res.status})`
        phase = 'idle'
        streaming = false
        workingMessages = []
        return
      }

      await consumeAgentChatStream(res, {
        getMessages: () => workingMessages,
        msgIdx,
        suppressAgentDetailAutoOpen: true,
        isActiveSession: () => true,
        isHearRepliesEnabled: () => false,
        setSessionId: () => {},
        setChatTitle: () => {},
        touchMessages: touchWorkingMessages,
        scrollToBottom: () => conversationEl?.scrollToBottom(),
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        phase = 'idle'
        streaming = false
        workingMessages = []
        return
      }
      genericError = 'Preview couldn’t run. Try again.'
      phase = 'idle'
      streaming = false
      workingMessages = []
      return
    }

    streaming = false
    const early = extractBrainQueryEarlyRejectionFromChatMessages(workingMessages)
    if (early) {
      completedTurns = [
        ...completedTurns,
        {
          question,
          draftAnswer: '',
          returnedToCollaborator: early.explanation,
          filterNotes: early.reason
            ? JSON.stringify({ early_rejection: true, reason: early.reason })
            : JSON.stringify({ early_rejection: true }),
          status: 'early_rejected',
          researchMessages: cloneChatMessagesSnapshot(workingMessages),
        },
      ]
      phase = 'idle'
      workingMessages = []
      return
    }

    const draftAnswer = lastAssistantPlainTextFromMessages(workingMessages)
    if (!draftAnswer.trim()) {
      genericError = 'Preview couldn’t run. Try again.'
      phase = 'idle'
      workingMessages = []
      return
    }

    phase = 'filter'
    try {
      const fres = await fetch('/api/brain-query/preview/filter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          draftAnswer,
          privacyPolicy: policyText,
        }),
        signal: ac.signal,
      })
      const j = (await fres.json().catch(() => ({}))) as {
        ok?: boolean
        status?: string
        finalAnswer?: string
        filterNotes?: string | null
        message?: string
      }

      if (!fres.ok || j.ok !== true || typeof j.finalAnswer !== 'string') {
        genericError =
          typeof j.message === 'string' && j.message.length > 0
            ? `Preview couldn’t run. Try again. (${j.message})`
            : 'Preview couldn’t run. Try again.'
        phase = 'idle'
        workingMessages = []
        return
      }

      const st = j.status === 'filter_blocked' ? 'filter_blocked' : 'ok'
      completedTurns = [
        ...completedTurns,
        {
          question,
          draftAnswer,
          returnedToCollaborator: j.finalAnswer,
          filterNotes: typeof j.filterNotes === 'string' || j.filterNotes === null ? j.filterNotes : null,
          status: st,
          researchMessages: cloneChatMessagesSnapshot(workingMessages),
        },
      ]
    } catch {
      genericError = 'Preview couldn’t run. Try again.'
    } finally {
      phase = 'idle'
      workingMessages = []
    }
  }

  const composerStreaming = $derived(streaming || phase !== 'idle')

  async function handleComposerSend(text: string): Promise<void> {
    const q = text.trim()
    if (!q || busy || phase !== 'idle' || streaming || !canonicalPrivacyPolicy.trim()) return
    await runPreviewTurn(q)
  }
</script>

<div class="answer-preview-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-foreground">
  <PaneL2Header>
    {#snippet center()}
      <div class="flex min-h-0 min-w-0 flex-1 items-center">
        <BrainAccessBreadcrumbs
          variant="preview"
          policyLabel={policyLabel}
          onGoToList={() => props.onBackToBrainAccessList()}
          onGoToPolicy={() => props.onBackToPolicy()}
          onGoToSettings={() => props.onNavigateToSettingsRoot()}
        />
      </div>
    {/snippet}
  </PaneL2Header>

  <div class="answer-preview-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
    <div
      class="answer-preview-inner mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 pb-6 pt-4 max-md:px-4 max-md:pb-4"
    >
  <header class="flex flex-col gap-2">
    <h1 class="m-0 text-[1.35rem] font-extrabold tracking-tight text-foreground">Test policy responses</h1>
    <p class="m-0 max-w-[42rem] text-[0.875rem] leading-relaxed text-muted">
      Run a sample question to see your assistant’s full research (private), the answer collaborators would get, and what
      was trimmed or withheld.
    </p>
    <p class="m-0 text-[0.8125rem] text-muted">Previews aren’t saved to inbound activity.</p>
  </header>

  {#if loadError}
    <p class="m-0 text-[0.875rem] text-red-600 dark:text-red-400" role="alert">{loadError}</p>
  {/if}

  {#if genericError}
    <p class="m-0 text-[0.875rem] text-red-600 dark:text-red-400" role="alert">{genericError}</p>
  {/if}

  <section class="flex min-h-0 flex-1 flex-col gap-8" aria-label="Cross-brain preview">
    {#if completedTurns.length === 0 && phase === 'idle' && !streaming && workingMessages.length === 0}
      <p class="m-0 text-[0.8125rem] text-muted">
        Ask a question below to see how this policy filters replies—you’ll get the private research pass, the
        collaborator-facing answer, and a short note on what changed.
      </p>
    {/if}

    <ul class="m-0 flex list-none flex-col gap-10 p-0">
      {#each completedTurns as turn, i (i)}
        {@const parsed = parseBrainQueryFilterNotes(turn.filterNotes)}
        <li class="flex flex-col gap-4">
          <div class="text-left">
            <div class="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">Question</div>
            <div
              class="rounded-md border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-3/80 px-2.5 py-2 text-left text-[0.8125rem] whitespace-pre-wrap text-foreground"
            >
              {turn.question.trim() || '—'}
            </div>
          </div>

          <div
            class="overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-violet-500/[0.06] dark:bg-violet-400/[0.08]"
          >
          <div
            class="flex flex-col gap-0.5 border-b border-[color-mix(in_srgb,var(--border)_35%,transparent)] px-3 py-2"
          >
            <div class="flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200">
              <Lock size={14} aria-hidden="true" />
              Private Research
            </div>
            <div class="text-[0.625rem] font-normal normal-case tracking-normal text-violet-700 dark:text-violet-300">
              Internal work with privileged access—not visible to others
            </div>
          </div>
            <div class="min-h-[120px] bg-surface">
              {#key i}
                <AgentConversation
                  messages={turn.researchMessages}
                  streaming={false}
                  toolDisplayMode={toolDisplayMode}
                />
              {/key}
            </div>
          </div>

          <div
            class="rounded-lg border border-emerald-500/50 bg-emerald-500/[0.07] px-3 py-3 dark:bg-emerald-400/[0.09]"
          >
            <div
              class="mb-2 flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200"
            >
              <Users size={14} aria-hidden="true" />
              Collaborator sees
            </div>
            <div class="text-[0.8125rem] whitespace-pre-wrap text-foreground">
              {#if turn.status === 'early_rejected'}
                <span class="font-medium text-muted">Declined</span>
                {' '}
              {:else if turn.status === 'filter_blocked'}
                <span class="font-medium text-muted">No answer shared.</span>
                {' '}
              {/if}
              {turn.returnedToCollaborator.trim() || '—'}
            </div>
          </div>

          {#if parsed.redactions.length > 0 || parsed.plainText}
            <div
              class="rounded-lg border border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-violet-500/[0.06] px-3 py-3 dark:bg-violet-400/[0.08]"
            >
              <div
                class="mb-2 flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200"
              >
                <Lock size={14} aria-hidden="true" />
                Only you — What changed
              </div>
              {#if parsed.redactions.length > 0}
                <ul class="m-0 mb-2 flex flex-wrap gap-1.5 p-0">
                  {#each parsed.redactions as label (label)}
                    <li
                      class="list-none rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-2 py-0.5 text-[0.6875rem] text-foreground"
                    >
                      {label}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if parsed.plainText}
                <div class="whitespace-pre-wrap text-[0.8125rem] text-muted">{parsed.plainText}</div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if workingMessages.length > 0}
      <article
        class={`flex flex-col gap-4 ${completedTurns.length > 0 ? 'border-t border-border pt-6' : ''}`}
        aria-busy={streaming || phase !== 'idle'}
      >
        <div class="text-left">
          <div class="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">Question</div>
          <div
            class="rounded-md border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-3/80 px-2.5 py-2 text-left text-[0.8125rem] whitespace-pre-wrap text-foreground"
          >
            {activeQuestionPreview || '—'}
          </div>
        </div>

        <div
          class="overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-violet-500/[0.06] dark:bg-violet-400/[0.08]"
        >
          <div
            class="flex flex-col gap-0.5 border-b border-[color-mix(in_srgb,var(--border)_35%,transparent)] px-3 py-2"
          >
            <div class="flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200">
              <Lock size={14} aria-hidden="true" />
              Private Research
            </div>
            <div class="text-[0.625rem] font-normal normal-case tracking-normal text-violet-700 dark:text-violet-300">
              Internal work with privileged access—not visible to others
            </div>
          </div>
          <div class="min-h-[200px] bg-surface">
            <AgentConversation
              bind:this={conversationEl}
              messages={workingMessages}
              streaming={streaming}
              toolDisplayMode={toolDisplayMode}
            />
          </div>
        </div>

        {#if phase === 'filter'}
          <div
            class="rounded-lg border border-emerald-500/50 bg-emerald-500/[0.07] px-3 py-3 dark:bg-emerald-400/[0.09]"
          >
            <div
              class="mb-2 flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200"
            >
              <Users size={14} aria-hidden="true" />
              Collaborator sees
            </div>
            <p class="m-0 text-[0.8125rem] text-muted">Applying policy…</p>
          </div>
        {/if}
      </article>
    {/if}

    <div class="mt-auto flex flex-col gap-2 border-t border-border pt-4">
      <div class="min-w-0">
        <UnifiedChatComposer
          voiceEligible={false}
          sessionResetKey={String(composerSessionKey)}
          placeholder={previewComposerPlaceholder}
          streaming={composerStreaming}
          queuedMessages={[]}
          wikiFiles={[]}
          skills={[]}
          transparentSurround={false}
          onSend={(t) => void handleComposerSend(t)}
          onTranscribe={(text) => void handleComposerSend(text)}
        />
      </div>
      {#if phase === 'research' || phase === 'filter'}
        <span class="text-[0.8125rem] text-muted" role="status">Preparing your preview…</span>
      {/if}
    </div>
  </section>
    </div>
  </div>
</div>
