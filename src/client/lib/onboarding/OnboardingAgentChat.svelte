<script lang="ts">
  /**
   * Same conversation UI as the main assistant (AgentConversation + AgentInput + PaneL2Header)
   * with SSE wired to onboarding profile/seed endpoints instead of /api/chat.
   */
  import { onMount, tick } from 'svelte'
  import { type SurfaceContext } from '../../router.js'
  import { extractMentionedFiles, type ChatMessage, type ToolPart } from '../agentUtils.js'
  import { contextPlaceholder } from '../agentUtils.js'
  import { emit } from '../app/appEvents.js'
  import { MessageSquarePlus } from 'lucide-svelte'
  import AgentConversation from '../agent-conversation/AgentConversation.svelte'
  import AgentInput from '../AgentInput.svelte'
  import PaneL2Header from '../PaneL2Header.svelte'

  let {
    endpoint,
    autoSendMessage = null as string | null,
    headerTitle = 'Chat',
    onStreamFinished,
    showNewChat = false,
    /** Replaces the main assistant’s inbox/calendar empty state while messages.length === 0. */
    emptyLead = "Let's get started — we'll use your connected email to build your profile here.",
    emptySub = "This is the same Brain chat you use every day: streaming replies, tools, and thinking. Starting in a moment…",
  }: {
    /** e.g. `/api/onboarding/profile` or `/api/onboarding/seed` */
    endpoint: string
    /** If set, sends this as the first user message once on mount (profiling / seed kickoff). */
    autoSendMessage?: string | null
    headerTitle?: string
    onStreamFinished?: () => void | Promise<void>
    showNewChat?: boolean
    emptyLead?: string
    emptySub?: string
  } = $props()

  const context: SurfaceContext = { type: 'chat' }

  let messages = $state<ChatMessage[]>([])
  let sessionId = $state<string | null>(null)
  let chatTitle = $state<string | null>(null)
  let streaming = $state(false)
  let wikiFiles = $state<string[]>([])
  let conversationEl = $state<ReturnType<typeof AgentConversation> | undefined>(undefined)
  let inputEl = $state<ReturnType<typeof AgentInput> | undefined>(undefined)
  let abortController: AbortController | null = null

  $effect(() => {
    void fetchWikiFiles()
  })

  async function fetchWikiFiles() {
    try {
      const res = await fetch('/api/wiki')
      const files = await res.json()
      wikiFiles = files.map((f: { path: string }) => f.path)
    } catch {
      /* ignore */
    }
  }

  function newChat() {
    messages = []
    sessionId = null
    chatTitle = null
    void tick().then(() => inputEl?.focus())
  }

  function stopChat() {
    abortController?.abort()
  }

  async function send(text: string) {
    if (!text || streaming) return

    let touchedWiki = false
    const writeOpenedWikiForToolId = new Set<string>()
    const editOpenedWikiForToolId = new Set<string>()
    const writePathByToolId = new Map<string, string>()
    const toolArgsByToolId = new Map<string, Record<string, unknown>>()
    const mentionedFiles = extractMentionedFiles(text)

    messages = [...messages, { role: 'user', content: text }]
    streaming = true

    const body: Record<string, unknown> = {
      message: text,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    if (sessionId) body.sessionId = sessionId
    if (mentionedFiles.length) body.context = `Referenced files: ${mentionedFiles.join(', ')}`

    messages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = messages.length - 1

    abortController = new AbortController()
    let sawDone = false

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!res.ok) {
        messages[msgIdx].parts!.push({ type: 'text', content: `Error: ${res.status} ${res.statusText}` })
        streaming = false
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastEvent = 'message'

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEvent = line.slice(7).trim()
            continue
          }
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            const msg = messages[msgIdx]

            switch (lastEvent) {
              case 'session':
                sessionId = data.sessionId
                break
              case 'text_delta': {
                const parts = msg.parts!
                const last = parts[parts.length - 1]
                if (last?.type === 'text') {
                  last.content += data.delta
                } else {
                  parts.push({ type: 'text', content: data.delta })
                }
                conversationEl?.scrollToBottom()
                break
              }
              case 'thinking':
                msg.thinking = (msg.thinking ?? '') + data.delta
                break
              case 'tool_args': {
                if (data.name === 'write') {
                  const path = typeof data.args?.path === 'string' ? data.args.path : ''
                  if (path) writePathByToolId.set(data.id, path)
                  if (path && !writeOpenedWikiForToolId.has(data.id)) {
                    writeOpenedWikiForToolId.add(data.id)
                  }
                } else if (data.name === 'edit') {
                  const path = typeof data.args?.path === 'string' ? data.args.path : ''
                  if (path && !editOpenedWikiForToolId.has(data.id)) {
                    editOpenedWikiForToolId.add(data.id)
                  }
                }
                break
              }
              case 'tool_start': {
                if (data.name === 'set_chat_title') {
                  const parts = msg.parts!
                  const existing = parts.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                  if (existing) {
                    existing.toolCall.name = data.name
                    existing.toolCall.args = data.args
                  } else {
                    parts.push({
                      type: 'tool',
                      toolCall: { id: data.id, name: data.name, args: data.args, done: false },
                    })
                  }
                  if (typeof data.args?.title === 'string') {
                    const t = data.args.title.trim().slice(0, 120)
                    if (t) chatTitle = t
                  }
                  messages = [...messages]
                } else if (data.name !== 'write') {
                  if (data.args != null && typeof data.args === 'object') {
                    toolArgsByToolId.set(data.id, data.args as Record<string, unknown>)
                  }
                }
                conversationEl?.scrollToBottom()
                break
              }
              case 'tool_end': {
                let part = msg.parts!.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                const writePath = data.name === 'write' ? writePathByToolId.get(data.id) : undefined
                const stashedArgs = toolArgsByToolId.get(data.id)
                toolArgsByToolId.delete(data.id)
                const endArgs =
                  data.args != null && typeof data.args === 'object' ? data.args : stashedArgs
                const resolvedArgs = writePath ? { path: writePath } : endArgs ?? {}
                if (!part) {
                  part = {
                    type: 'tool',
                    toolCall: {
                      id: data.id,
                      name: data.name,
                      args: resolvedArgs,
                      result: data.result,
                      details: data.details,
                      isError: data.isError,
                      done: true,
                    },
                  }
                  msg.parts!.push(part)
                } else {
                  part.toolCall.result = data.result
                  if (data.details !== undefined) part.toolCall.details = data.details
                  part.toolCall.isError = data.isError
                  part.toolCall.done = true
                  if (writePath) part.toolCall.args = { path: writePath }
                  else if (endArgs !== undefined) part.toolCall.args = endArgs
                }
                const name = part.toolCall.name
                if (name === 'write' || name === 'edit' || name === 'delete') touchedWiki = true
                if (name === 'write') {
                  writePathByToolId.delete(data.id)
                }
                messages = [...messages]
                conversationEl?.scrollToBottom()
                break
              }
              case 'error':
                msg.parts!.push({ type: 'text', content: `\n\n**Error:** ${data.message}` })
                break
              case 'done':
                sawDone = true
                break
            }
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      if (name !== 'AbortError') {
        messages[msgIdx].parts!.push({ type: 'text', content: `\n\n**Connection error:** ${errMsg}` })
      }
    } finally {
      abortController = null
      streaming = false
      conversationEl?.scrollToBottom()
      if (touchedWiki) emit({ type: 'wiki:mutated', source: 'agent' })
      if (sawDone) void onStreamFinished?.()
    }
  }

  onMount(() => {
    if (autoSendMessage?.trim()) {
      void tick().then(() => send(autoSendMessage.trim()))
    }
  })

  const placeholder = $derived(contextPlaceholder(context))
</script>

{#snippet onboardingEmpty()}
  <div class="onboarding-empty">
    <p class="onboarding-empty-lead">{emptyLead}</p>
    <p class="onboarding-empty-sub">{emptySub}</p>
  </div>
{/snippet}

<div class="agent-drawer onboarding-agent-chat">
  <div class="drawer-body">
    <div>
      <PaneL2Header>
        {#snippet center()}
          <div class="header-left">
            <span class="drawer-title" class:thinking={streaming} class:custom-title={!!chatTitle}>
              {streaming ? 'Thinking...' : (chatTitle ?? headerTitle)}
            </span>
          </div>
        {/snippet}
        {#snippet right()}
          {#if showNewChat && messages.length > 0}
            <button class="new-btn" type="button" onclick={() => newChat()} title="New conversation">
              <MessageSquarePlus size={14} strokeWidth={2} aria-hidden="true" />
              <span>New</span>
            </button>
          {/if}
        {/snippet}
      </PaneL2Header>
    </div>

    <div class="mid">
      <AgentConversation
        bind:this={conversationEl}
        {messages}
        {streaming}
        empty={onboardingEmpty}
        onOpenWiki={undefined}
        onOpenEmail={undefined}
        onOpenFullInbox={undefined}
        onOpenImessage={undefined}
        onSwitchToCalendar={undefined}
      />
    </div>
  </div>

  <div class="input-shell">
    <AgentInput
      bind:this={inputEl}
      {placeholder}
      {streaming}
      disabled={streaming}
      {wikiFiles}
      onSend={send}
      onStop={stopChat}
    />
  </div>
</div>

<style>
  .agent-drawer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-2);
    border-radius: 10px;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .onboarding-agent-chat {
    min-height: min(70vh, 640px);
  }

  .drawer-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .input-shell {
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }

  .drawer-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .drawer-title.custom-title {
    text-transform: none;
    letter-spacing: 0.02em;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-title.thinking {
    animation: pulse-thinking 1.5s ease-in-out infinite;
  }
  @keyframes pulse-thinking {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .new-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-2);
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    transition:
      color 0.15s,
      background 0.15s;
  }
  .new-btn :global(svg) {
    flex-shrink: 0;
    opacity: 0.9;
  }
  .new-btn:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  .mid {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .onboarding-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    min-height: 100%;
    padding: 8px 12px 28px;
    box-sizing: border-box;
    text-align: center;
    max-width: 28rem;
    margin: 0 auto;
  }

  .onboarding-empty-lead {
    margin: 0 0 10px;
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    line-height: 1.45;
  }

  .onboarding-empty-sub {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.5;
    opacity: 0.92;
  }
</style>
