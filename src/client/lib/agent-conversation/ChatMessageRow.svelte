<script lang="ts">
  import { renderMarkdown } from '../markdown.js'
  import { getToolUiPolicy, type ChatMessage } from '../agentUtils.js'
  import ToolCallBlock from './ToolCallBlock.svelte'

  let {
    msg,
    streaming,
    isLastMessage,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: {
    msg: ChatMessage
    streaming: boolean
    isLastMessage: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  } = $props()
</script>

<div class="message {msg.role}">
  {#if msg.role === 'user'}
    <div class="msg-label">You</div>
    <div class="msg-content user-content">{msg.content}</div>
  {:else}
    <div class="msg-label">Assistant</div>

    {#each msg.parts ?? [] as part, j (j)}
      {#if part.type === 'tool' && getToolUiPolicy(part.toolCall.name).showInChat}
        <ToolCallBlock
          toolCall={part.toolCall}
          {onOpenWiki}
          {onOpenFile}
          {onOpenEmail}
          {onOpenFullInbox}
          {onSwitchToCalendar}
          {onOpenMessageThread}
        />
      {:else if part.type === 'text' && part.content}
        <div class="msg-content markdown">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html renderMarkdown(part.content)}
        </div>
      {/if}
    {/each}

    {#if streaming && isLastMessage && !msg.parts?.length}
      <div class="msg-content"><span class="cursor">|</span></div>
    {/if}
  {/if}
</div>

<style>
  .message {
    margin-bottom: 20px;
    max-width: min(800px, 100%);
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .message.user {
    border-left: 2px solid var(--border);
    padding-left: 10px;
    opacity: 0.7;
  }

  .msg-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
    margin-bottom: 4px;
  }

  .user-content {
    color: var(--text);
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.5;
  }

  .markdown {
    font-size: 14px;
    line-height: 1.6;
    min-width: 0;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  .markdown :global(h1) {
    font-size: 1.4em;
    margin: 0.8em 0 0.4em;
  }
  .markdown :global(h2) {
    font-size: 1.2em;
    margin: 0.8em 0 0.3em;
  }
  .markdown :global(h3) {
    font-size: 1.05em;
    margin: 0.6em 0 0.2em;
  }
  .markdown :global(p) {
    margin-bottom: 0.6em;
  }
  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0.4em 0 0.6em 1.2em;
  }
  .markdown :global(code) {
    background: var(--bg-3);
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-size: 0.88em;
  }
  .markdown :global(pre) {
    background: var(--bg-3);
    padding: 10px 14px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  .markdown :global(pre code) {
    background: none;
    padding: 0;
  }
  .markdown :global(blockquote) {
    border-left: 3px solid var(--border);
    padding-left: 10px;
    color: var(--text-2);
    margin: 0.5em 0;
  }
  .markdown :global(a) {
    color: var(--accent);
  }
  .markdown :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
    font-size: 13px;
  }
  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid var(--border);
    padding: 4px 8px;
  }
  .markdown :global(th) {
    background: var(--bg-3);
  }
  .markdown :global(.date-link),
  .markdown :global(.wiki-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    cursor: pointer;
    font: inherit;
    font-size: inherit;
    padding: 0;
    background: none;
    border: none;
  }
  .markdown :global(.date-link:hover),
  .markdown :global(.wiki-link:hover) {
    text-decoration-style: solid;
  }

  .cursor {
    animation: blink 1s infinite;
    color: var(--accent);
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
</style>
