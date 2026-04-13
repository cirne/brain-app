<script lang="ts">
  import { type SurfaceContext } from '../router.js'
  import { buildChatBody, extractMentionedFiles, type ChatMessage, type ToolPart } from './agentUtils.js'
  import { contextPlaceholder } from './agentUtils.js'
  import AgentConversation from './AgentConversation.svelte'
  import AgentInput from './AgentInput.svelte'

  let {
    context = { type: 'none' } as SurfaceContext,
    onOpenWiki,
    onSwitchToCalendar,
  }: {
    context?: SurfaceContext
    onOpenWiki?: (_path: string) => void
    onSwitchToCalendar?: (_date: string) => void
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
  let conversationEl: ReturnType<typeof AgentConversation> | undefined

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
      wikiFiles = files.map((f: any) => f.path)
    } catch { /* ignore */ }
  }

  function newChat() {
    messages = []
    sessionId = null
  }

  async function send(text: string) {
    if (!text || streaming) return

    const mentionedFiles = extractMentionedFiles(text)
    const isFirstMessage = messages.length === 0

    messages = [...messages, { role: 'user', content: text }]
    streaming = true

    const body = buildChatBody({ message: text, sessionId, context, mentionedFiles, isFirstMessage })

    messages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = messages.length - 1

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
              case 'tool_start':
                msg.parts!.push({ type: 'tool', toolCall: { id: data.id, name: data.name, args: data.args, done: false } })
                conversationEl?.scrollToBottom()
                break
              case 'tool_end': {
                const part = msg.parts!.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                if (part) {
                  part.toolCall.result = data.result
                  part.toolCall.isError = data.isError
                  part.toolCall.done = true
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
    } catch (err: any) {
      messages[msgIdx].parts!.push({ type: 'text', content: `\n\n**Connection error:** ${err.message}` })
    } finally {
      streaming = false
      conversationEl?.scrollToBottom()
    }
  }

  const placeholder = $derived(contextPlaceholder(context))

  const contextChip = $derived.by((): string | null => {
    if (context.type === 'email') return `📧 ${context.subject}`
    if (context.type === 'wiki') return `📄 ${context.title}`
    if (context.type === 'calendar') return `📅 ${context.date}`
    return null
  })
</script>

<div class="agent-drawer">
  <div class="drawer-header">
    <div class="header-left">
      <span class="drawer-title">{streaming ? 'Thinking...' : 'Chat'}</span>
      {#if contextChip}
        <span class="context-chip">{contextChip}</span>
      {/if}
    </div>
    {#if messages.length > 0}
      <button class="new-btn" onclick={newChat} title="New conversation">New</button>
    {/if}
  </div>

  <AgentConversation
    bind:this={conversationEl}
    {messages}
    {streaming}
    {onOpenWiki}
    {onSwitchToCalendar}
  />

  <AgentInput
    {placeholder}
    disabled={streaming}
    {wikiFiles}
    onSend={send}
  />
</div>

<style>
  .agent-drawer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-2);
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 36px;
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
</style>
