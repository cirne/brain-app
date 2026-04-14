<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import { type SurfaceContext } from '../router.js'
  import { buildChatBody, extractMentionedFiles, type ChatMessage, type ToolPart } from './agentUtils.js'
  import { contextPlaceholder } from './agentUtils.js'
  import AgentConversation from './AgentConversation.svelte'
  import AgentInput from './AgentInput.svelte'
  import WikiFileName from './WikiFileName.svelte'

  let {
    context = { type: 'none' } as SurfaceContext,
    conversationHidden = false,
    onOpenWiki,
    onOpenEmail,
    onSwitchToCalendar,
    onOpenFromAgent,
    onWikiMutated,
    mobileDetail,
  }: {
    context?: SurfaceContext
    conversationHidden?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_threadId: string) => void
    onSwitchToCalendar?: (_date: string) => void
    /** LLM `open` tool — fired from SSE tool_start */
    onOpenFromAgent?: (_target: { type: string; path?: string; id?: string; date?: string }) => void
    onWikiMutated?: () => void
    /** Full-screen detail stack above input (mobile only) */
    mobileDetail?: Snippet
  } = $props()

  const STORAGE_KEY = 'brain-agent'

  function loadState(): { messages: ChatMessage[]; sessionId: string | null } {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return { messages: [], sessionId: null }
  }

  const initial = loadState()
  let messages = $state<ChatMessage[]>(initial.messages)
  let sessionId = $state<string | null>(initial.sessionId)
  let streaming = $state(false)
  let wikiFiles = $state<string[]>([])
  let conversationEl = $state<ReturnType<typeof AgentConversation> | undefined>(undefined)
  let inputEl = $state<ReturnType<typeof AgentInput> | undefined>(undefined)
  let abortController: AbortController | null = null

  async function focusAgentTextarea(delayMs: number) {
    await tick()
    if (delayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, delayMs))
    }
    inputEl?.focus()
  }

  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, sessionId }))
    } catch { /* ignore */ }
  })

  $effect(() => { fetchWikiFiles() })

  async function fetchWikiFiles() {
    try {
      const res = await fetch('/api/wiki')
      const files = await res.json()
      wikiFiles = files.map((f: { path: string }) => f.path)
    } catch { /* ignore */ }
  }

  export function newChat() {
    messages = []
    sessionId = null
    void focusAgentTextarea(0)
  }

  export async function newChatWithMessage(text: string) {
    messages = []
    sessionId = null
    await tick()
    await send(text)
  }

  function stopChat() {
    abortController?.abort()
  }

  async function send(text: string) {
    if (!text || streaming) return

    let touchedWiki = false
    const mentionedFiles = extractMentionedFiles(text)
    const isFirstMessage = messages.length === 0

    messages = [...messages, { role: 'user', content: text }]
    streaming = true

    const body = buildChatBody({ message: text, sessionId, context, mentionedFiles, isFirstMessage })

    messages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = messages.length - 1

    abortController = new AbortController()

    try {
      const res = await fetch('/api/chat', {
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
          if (line.startsWith('event: ')) { lastEvent = line.slice(7).trim(); continue }
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
              case 'tool_start': {
                msg.parts!.push({ type: 'tool', toolCall: { id: data.id, name: data.name, args: data.args, done: false } })
                if (data.name === 'open' && data.args?.target && onOpenFromAgent) {
                  onOpenFromAgent(data.args.target)
                }
                conversationEl?.scrollToBottom()
                break
              }
              case 'tool_end': {
                const part = msg.parts!.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                if (part) {
                  part.toolCall.result = data.result
                  part.toolCall.isError = data.isError
                  part.toolCall.done = true
                  const name = part.toolCall.name
                  if (name === 'write' || name === 'edit' || name === 'delete') touchedWiki = true
                  conversationEl?.scrollToBottom()
                }
                break
              }
              case 'error':
                msg.parts!.push({ type: 'text', content: `\n\n**Error:** ${data.message}` })
                break
              case 'done':
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
      if (touchedWiki) onWikiMutated?.()
    }
  }

  const placeholder = $derived(contextPlaceholder(context))

  const contextChip = $derived.by((): string | null => {
    if (context.type === 'email') return `📧 ${context.subject}`
    if (context.type === 'calendar') return `📅 ${context.date}`
    if (context.type === 'inbox') return '📥 Inbox'
    return null
  })
</script>

<div class="agent-drawer">
  <div class="drawer-header">
    <div class="header-left">
      <span class="drawer-title" class:thinking={streaming}>{streaming ? 'Thinking...' : 'Chat'}</span>
      {#if context.type === 'wiki'}
        <span class="context-chip"><WikiFileName path={context.path} /></span>
      {:else if contextChip}
        <span class="context-chip">{contextChip}</span>
      {/if}
    </div>
    {#if messages.length > 0}
      <button class="new-btn" onclick={() => newChat()} title="New conversation (⌘N)">New</button>
    {/if}
  </div>

  <div class="mid">
    {#if !conversationHidden}
      <AgentConversation
        bind:this={conversationEl}
        {messages}
        {streaming}
        {onOpenWiki}
        {onOpenEmail}
        {onSwitchToCalendar}
      />
    {/if}
    {#if conversationHidden && mobileDetail}
      <div class="mobile-detail-layer">
        {@render mobileDetail()}
      </div>
    {/if}
  </div>

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

<style>
  .agent-drawer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-2);
    min-height: 0;
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 44px;
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
  .drawer-title.thinking {
    animation: pulse-thinking 1.5s ease-in-out infinite;
  }
  @keyframes pulse-thinking {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .context-chip {
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  .new-btn {
    font-size: 11px;
    color: var(--text-2);
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .new-btn:hover { color: var(--text); background: var(--bg-3); }

  .mid {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .mobile-detail-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
  }

  .mobile-detail-layer :global(.slide-over) {
    border-left: none;
  }
</style>
