<script lang="ts">
  /**
   * Alternate AgentChat conversation surface for onboarding profile build:
   * calm copy + activity line + referenced wiki paths and mail (no chat transcript).
   */
  import { onMount, tick } from 'svelte'
  import { Mail } from 'lucide-svelte'
  import type { AgentConversationViewProps } from '../agentConversationViewTypes.js'
  import WikiFileName from '../WikiFileName.svelte'
  import { getToolIcon } from '../toolIcons.js'
  import { getToolUiPolicy, type ToolCall } from '../agentUtils.js'
  import { computePinnedToBottom } from '../scrollPin.js'
  import { extractProfilingResources, profilingActivityLine } from './profilingResources.js'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenEmail,
  }: AgentConversationViewProps = $props()

  let messagesEl: HTMLElement
  let followOutput = $state(true)
  let reduceMotion = $state(false)

  const resources = $derived(extractProfilingResources(messages))
  const activity = $derived(profilingActivityLine(messages, streaming))

  const lastTool = $derived.by((): ToolCall | null => {
    let last: ToolCall | null = null
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      for (const part of msg.parts ?? []) {
        if (part.type === 'tool') last = part.toolCall
      }
    }
    return last
  })

  const lastToolIcon = $derived(lastTool ? getToolIcon(lastTool.name) : null)
  const lastToolLabel = $derived(
    lastTool ? getToolUiPolicy(lastTool.name).label ?? lastTool.name : '',
  )

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reduceMotion = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  })

  function syncFollowFromScroll() {
    if (!messagesEl) return
    followOutput = computePinnedToBottom(messagesEl)
  }

  export function scrollToBottom() {
    void tick().then(() => {
      requestAnimationFrame(() => {
        if (!messagesEl) return
        messagesEl.scrollTop = messagesEl.scrollHeight
        followOutput = true
      })
    })
  }

  export function scrollToBottomIfFollowing() {
    void tick().then(() => {
      requestAnimationFrame(() => {
        if (!messagesEl || !followOutput) return
        messagesEl.scrollTop = messagesEl.scrollHeight
      })
    })
  }

  $effect(() => {
    void messages
    void streaming
    if (streaming && followOutput) scrollToBottomIfFollowing()
  })
</script>

<div class="ob-prof-shell">
  <div
    class="ob-prof-scroll"
    bind:this={messagesEl}
    onscroll={syncFollowFromScroll}
  >
    <div class="ob-prof-inner">
      <h1 class="ob-prof-title">Building your profile</h1>
      <p class="ob-prof-lead">
        We read patterns from your mail on this Mac to draft a short profile. Nothing leaves your machine unless you
        choose to later.
      </p>

      {#if streaming && activity}
        <p class="ob-prof-activity" role="status" aria-live="polite">
          <span class="ob-prof-pulse" aria-hidden="true" class:ob-prof-pulse--still={reduceMotion}></span>
          {activity}
        </p>
      {:else if streaming}
        <p class="ob-prof-activity" role="status" aria-live="polite">
          <span class="ob-prof-pulse" aria-hidden="true"></span>
          Working…
        </p>
      {/if}

      {#if streaming && lastTool && lastToolIcon}
        {@const Icon = lastToolIcon}
        <p class="ob-prof-tool-hint">
          <Icon size={12} strokeWidth={2.25} class="ob-prof-tool-icon" aria-hidden="true" />
          <span>{lastToolLabel}</span>
        </p>
      {/if}

      {#if resources.wikiPaths.length > 0}
        <section class="ob-prof-section" aria-labelledby="ob-prof-wiki-heading">
          <h2 id="ob-prof-wiki-heading" class="ob-prof-section-title">Notes</h2>
          <ul class="ob-prof-chips">
            {#each resources.wikiPaths as path (path)}
              <li>
                <button type="button" class="ob-prof-chip" onclick={() => onOpenWiki?.(path)}>
                  <WikiFileName {path} />
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if resources.emails.length > 0 || resources.emailOverflow > 0}
        <section class="ob-prof-section" aria-labelledby="ob-prof-mail-heading">
          <h2 id="ob-prof-mail-heading" class="ob-prof-section-title">Mail referenced</h2>
          <ul class="ob-prof-mail-list">
            {#each resources.emails as row (row.id)}
              <li>
                <button
                  type="button"
                  class="ob-prof-mail-row"
                  onclick={() => onOpenEmail?.(row.id, row.subject, row.from)}
                >
                  <span class="ob-prof-mail-lead" aria-hidden="true">
                    <Mail size={12} />
                  </span>
                  <span class="ob-prof-mail-body">
                    <span class="ob-prof-mail-subject">{row.subject || '(No subject)'}</span>
                    <span class="ob-prof-mail-meta">{row.from}</span>
                    {#if row.snippet}
                      <span class="ob-prof-mail-snippet">{row.snippet}</span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
          {#if resources.emailOverflow > 0}
            <p class="ob-prof-overflow">+{resources.emailOverflow} more</p>
          {/if}
        </section>
      {/if}

      {#if !streaming && messages.length === 0}
        <p class="ob-prof-placeholder">Starting…</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .ob-prof-shell {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-2);
  }

  .ob-prof-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overflow-x: hidden;
  }

  .ob-prof-inner {
    max-width: var(--chat-column-max);
    margin: 0 auto;
    padding: 1.25rem 1rem 2rem;
    box-sizing: border-box;
  }

  .ob-prof-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0.5rem;
    letter-spacing: -0.02em;
  }

  .ob-prof-lead {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-2);
    max-width: 36rem;
  }

  .ob-prof-activity {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text);
    margin: 0 0 0.75rem;
    min-height: 1.25rem;
  }

  .ob-prof-pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: ob-prof-pulse 1.2s ease-in-out infinite;
  }

  .ob-prof-pulse--still {
    animation: none;
    opacity: 0.85;
  }

  @keyframes ob-prof-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .ob-prof-tool-hint {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0 0 1.25rem;
    font-size: 0.75rem;
    color: var(--text-2);
  }

  .ob-prof-tool-hint :global(.ob-prof-tool-icon) {
    flex-shrink: 0;
    opacity: 0.85;
  }

  .ob-prof-section {
    margin-top: 1.25rem;
  }

  .ob-prof-section-title {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin: 0 0 0.5rem;
  }

  .ob-prof-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ob-prof-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .ob-prof-chip:hover {
    border-color: var(--accent);
    background: var(--accent-dim);
  }

  .ob-prof-mail-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ob-prof-mail-row {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .ob-prof-mail-row:hover {
    border-color: var(--accent);
    background: var(--accent-dim);
  }

  .ob-prof-mail-lead {
    color: var(--text-2);
    flex-shrink: 0;
    padding-top: 2px;
  }

  .ob-prof-mail-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .ob-prof-mail-subject {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ob-prof-mail-meta {
    font-size: 0.6875rem;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ob-prof-mail-snippet {
    font-size: 0.6875rem;
    color: var(--text-2);
    opacity: 0.9;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ob-prof-overflow {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    color: var(--text-2);
  }

  .ob-prof-placeholder {
    margin: 1rem 0 0;
    font-size: 0.875rem;
    color: var(--text-2);
  }
</style>
