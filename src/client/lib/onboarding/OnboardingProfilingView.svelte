<script lang="ts">
  /**
   * Alternate AgentChat conversation surface for onboarding (profile build + wiki seeding):
   * activity + referenced paths/mail; streamed `me.md` appears at the bottom as an assistant message.
   */
  import { onMount, tick } from 'svelte'
  import { Check, Mail, User } from 'lucide-svelte'
  import type { AgentConversationViewProps } from '../agentConversationViewTypes.js'
  import WikiFileName from '../WikiFileName.svelte'
  import { getToolIcon } from '../toolIcons.js'
  import { getToolUiPolicy } from '../agentUtils.js'
  import { computePinnedToBottom } from '../scrollPin.js'
  import { renderMarkdown } from '../markdown.js'
  import {
    buildSeedingProgressUi,
    extractLastMeMdWriteContent,
    extractProfilingPeople,
    extractProfilingResources,
    isProfilingMeMdPath,
    lastMeaningfulToolCall,
    onboardingActivityLine,
  } from './profilingResources.js'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenEmail,
    onboardingKind: onboardingKindProp,
    streamingWrite = null,
  }: AgentConversationViewProps = $props()

  /** Parent may pass `undefined`; treat as profiling. */
  const onboardingKind = $derived(onboardingKindProp ?? 'profiling')

  let messagesEl: HTMLElement
  let followOutput = $state(true)
  let reduceMotion = $state(false)

  const resources = $derived(extractProfilingResources(messages))
  const peopleBlock = $derived(
    onboardingKind === 'profiling' ? extractProfilingPeople(messages) : { people: [], peopleOverflow: 0 },
  )
  const activity = $derived(onboardingActivityLine(messages, streaming, onboardingKind))

  const seedingProgress = $derived(
    onboardingKind === 'seeding' ? buildSeedingProgressUi(messages, streaming) : { rows: [], planning: null },
  )

  const title = $derived(
    onboardingKind === 'seeding' ? 'Setting up your wiki' : 'Building your profile',
  )
  const lead = $derived(
    onboardingKind === 'seeding'
      ? 'We are creating pages from your profile and mail—everything stays on this Mac.'
      : 'We read patterns from your mail on this Mac to draft a short profile. Nothing leaves your machine unless you choose to later.',
  )
  const wikiSectionTitle = $derived(onboardingKind === 'seeding' ? 'Pages' : 'Notes')

  /** Live or completed `me.md` body for profiling (streaming args, then tool result). */
  const profileDraftPreview = $derived.by(() => {
    if (onboardingKind !== 'profiling') return ''
    const sw = streamingWrite
    if (sw?.body?.trim() && isProfilingMeMdPath(sw.path)) return sw.body
    return extractLastMeMdWriteContent(messages) ?? ''
  })

  const profileDraftStreaming = $derived(
    Boolean(
      onboardingKind === 'profiling' &&
        streamingWrite?.body?.trim() &&
        streamingWrite.path &&
        isProfilingMeMdPath(streamingWrite.path),
    ),
  )

  const lastTool = $derived(lastMeaningfulToolCall(messages))

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
    void streamingWrite?.body
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
      <h1 class="ob-prof-title">{title}</h1>
      <p class="ob-prof-lead">{lead}</p>

      {#if onboardingKind === 'seeding' && (seedingProgress.rows.length > 0 || seedingProgress.planning)}
        <section class="ob-seed-progress-section" aria-labelledby="ob-seed-progress-heading">
          <h2 id="ob-seed-progress-heading" class="ob-prof-section-title">Progress</h2>
          <ul class="ob-seed-progress" role="list">
            {#each seedingProgress.rows as { done: rowDone, line: row } (row.id)}
              <li
                class="ob-seed-progress-row"
                class:ob-seed-progress-row--done={rowDone}
                class:ob-seed-progress-row--current={!rowDone}
                role={rowDone ? undefined : 'status'}
                aria-live={rowDone ? undefined : 'polite'}
              >
                {#if rowDone}
                  <span class="ob-seed-progress-check" aria-hidden="true">
                    <Check size={14} strokeWidth={2.5} class="ob-seed-progress-check-icon" />
                  </span>
                {:else}
                  <span class="ob-seed-progress-pulse-wrap" aria-hidden="true">
                    <span class="ob-prof-pulse" class:ob-prof-pulse--still={reduceMotion}></span>
                  </span>
                {/if}
                <span class="ob-seed-progress-body" class:ob-seed-progress-body--mail={!!row.mailPreview}>
                  {#if row.mailPreview}
                    <span class="ob-seed-progress-prefix">{row.prefix}</span>
                    <button
                      type="button"
                      class="ob-prof-mail-row ob-seed-mail-card"
                      onclick={() =>
                        onOpenEmail?.(row.mailPreview!.id, row.mailPreview!.subject, row.mailPreview!.from)}
                    >
                      <span class="ob-prof-mail-lead" aria-hidden="true">
                        <Mail size={12} />
                      </span>
                      <span class="ob-prof-mail-body">
                        <span class="ob-prof-mail-subject">
                          {row.mailPreview.subject.trim() ||
                            (rowDone ? '(No subject)' : 'Reading message…')}
                        </span>
                        {#if row.mailPreview.from.trim()}
                          <span class="ob-prof-mail-meta">{row.mailPreview.from}</span>
                        {/if}
                        {#if row.mailPreview.snippet.trim()}
                          <span class="ob-prof-mail-snippet">{row.mailPreview.snippet}</span>
                        {/if}
                      </span>
                    </button>
                  {:else}
                    <span class="ob-seed-progress-prefix">{row.prefix}</span>
                    {#if row.path}
                      <button
                        type="button"
                        class="ob-seed-progress-path"
                        onclick={() => onOpenWiki?.(row.path!)}
                      >
                        <WikiFileName path={row.path} />
                      </button>
                    {:else if !rowDone && (row.prefix === 'Writing' || row.prefix === 'Updating')}
                      <span class="ob-seed-progress-wait">…</span>
                    {/if}
                    {#if row.detail}
                      <span class="ob-seed-progress-detail">{row.detail}</span>
                    {/if}
                  {/if}
                </span>
              </li>
            {/each}
            {#if seedingProgress.planning}
              {@const prow = seedingProgress.planning}
              <li class="ob-seed-progress-row ob-seed-progress-row--current" role="status" aria-live="polite">
                <span class="ob-seed-progress-pulse-wrap" aria-hidden="true">
                  <span class="ob-prof-pulse" class:ob-prof-pulse--still={reduceMotion}></span>
                </span>
                <span class="ob-seed-progress-body">
                  <span class="ob-seed-progress-prefix ob-seed-progress-prefix--planning">{prow.prefix}</span>
                  {#if prow.detail}
                    <span class="ob-seed-progress-detail">{prow.detail}</span>
                  {/if}
                </span>
              </li>
            {/if}
          </ul>
        </section>
      {:else if streaming && activity}
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

      {#if onboardingKind !== 'seeding' && streaming && lastTool && lastToolIcon}
        {@const Icon = lastToolIcon}
        <p class="ob-prof-tool-hint">
          <Icon size={12} strokeWidth={2.25} class="ob-prof-tool-icon" aria-hidden="true" />
          <span>{lastToolLabel}</span>
        </p>
      {/if}

      {#if onboardingKind === 'profiling' && (peopleBlock.people.length > 0 || peopleBlock.peopleOverflow > 0)}
        <section class="ob-prof-section" aria-labelledby="ob-prof-people-heading">
          <h2 id="ob-prof-people-heading" class="ob-prof-section-title">People</h2>
          <ul class="ob-prof-people-list">
            {#each peopleBlock.people as row (row.id)}
              <li class="ob-prof-person-row">
                <span class="ob-prof-person-lead" aria-hidden="true">
                  <User size={12} />
                </span>
                <span class="ob-prof-person-body">
                  <span class="ob-prof-person-name">{row.name}</span>
                  {#if row.email}
                    <span class="ob-prof-person-email">{row.email}</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
          {#if peopleBlock.peopleOverflow > 0}
            <p class="ob-prof-overflow">+{peopleBlock.peopleOverflow} more</p>
          {/if}
        </section>
      {/if}

      {#if resources.wikiPaths.length > 0}
        <section class="ob-prof-section" aria-labelledby="ob-prof-wiki-heading">
          <h2 id="ob-prof-wiki-heading" class="ob-prof-section-title">{wikiSectionTitle}</h2>
          <ul class="ob-prof-chips">
            {#each resources.wikiPaths as path (path)}
              <li>
                <button type="button" class="ob-prof-chip" onclick={() => onOpenWiki?.(path)}>
                  <WikiFileName {path} />
                </button>
              </li>
            {/each}
          </ul>
          {#if resources.wikiOverflow > 0}
            <p class="ob-prof-overflow">+{resources.wikiOverflow} more</p>
          {/if}
        </section>
      {/if}

      {#if onboardingKind !== 'seeding' && (resources.emails.length > 0 || resources.emailOverflow > 0)}
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

      {#if onboardingKind === 'profiling' && profileDraftPreview.trim().length > 0}
        <div class="ob-prof-chat-msg" role="article" aria-label="Assistant message, me.md">
          <div class="ob-prof-msg-label">Assistant</div>
          {#if profileDraftStreaming}
            <p class="ob-prof-msg-stream-hint" role="status">Writing me.md…</p>
          {/if}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="ob-prof-msg-body markdown">{@html renderMarkdown(profileDraftPreview.slice(0, 50000))}</div>
        </div>
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

  /* Tail of pane: assistant message with streamed me.md (matches main chat transcript UX). */
  .ob-prof-chat-msg {
    margin-top: 1.25rem;
    margin-bottom: 20px;
    max-width: min(800px, 100%);
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .ob-prof-msg-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
    margin-bottom: 4px;
  }

  .ob-prof-msg-stream-hint {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    margin: 0 0 8px;
  }

  .ob-prof-msg-body {
    font-size: 14px;
    line-height: 1.6;
    min-width: 0;
    overflow-wrap: break-word;
    word-wrap: break-word;
    max-height: min(50vh, 26rem);
    overflow: auto;
    padding-right: 2px;
  }

  .ob-prof-msg-body :global(h1) {
    font-size: 1.4em;
    margin: 0.8em 0 0.4em;
  }
  .ob-prof-msg-body :global(h2) {
    font-size: 1.2em;
    margin: 0.8em 0 0.3em;
  }
  .ob-prof-msg-body :global(h3) {
    font-size: 1.05em;
    margin: 0.6em 0 0.2em;
  }
  .ob-prof-msg-body :global(p) {
    margin-bottom: 0.6em;
  }
  .ob-prof-msg-body :global(ul),
  .ob-prof-msg-body :global(ol) {
    margin: 0.4em 0 0.6em 1.2em;
  }
  .ob-prof-msg-body :global(code) {
    background: var(--bg-3);
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-size: 0.88em;
  }
  .ob-prof-msg-body :global(pre) {
    background: var(--bg-3);
    padding: 10px 14px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  .ob-prof-msg-body :global(pre code) {
    background: none;
    padding: 0;
  }
  .ob-prof-msg-body :global(blockquote) {
    border-left: 3px solid var(--border);
    padding-left: 10px;
    color: var(--text-2);
    margin: 0.5em 0;
  }
  .ob-prof-msg-body :global(a) {
    color: var(--accent);
  }
  .ob-prof-msg-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
    font-size: 13px;
  }
  .ob-prof-msg-body :global(th),
  .ob-prof-msg-body :global(td) {
    border: 1px solid var(--border);
    padding: 4px 8px;
  }
  .ob-prof-msg-body :global(th) {
    background: var(--bg-3);
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

  .ob-seed-progress-section {
    margin: 0 0 1rem;
  }

  .ob-seed-progress {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .ob-seed-progress-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    font-size: 0.8125rem;
    line-height: 1.45;
    min-width: 0;
  }

  .ob-seed-progress-row--done {
    color: var(--text-2);
  }

  .ob-seed-progress-row--current {
    color: var(--text);
    font-weight: 500;
  }

  .ob-seed-progress-check {
    flex-shrink: 0;
    padding-top: 2px;
    opacity: 0.8;
    color: var(--accent);
  }

  .ob-seed-progress-check :global(.ob-seed-progress-check-icon) {
    display: block;
  }

  .ob-seed-progress-pulse-wrap {
    flex-shrink: 0;
    width: 14px;
    display: flex;
    justify-content: center;
    padding-top: 4px;
  }

  .ob-seed-progress-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    min-width: 0;
  }

  .ob-seed-progress-body--mail {
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
  }

  .ob-seed-mail-card {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .ob-seed-progress-prefix {
    flex-shrink: 0;
  }

  .ob-seed-progress-prefix--planning {
    font-weight: 400;
    color: var(--text-2);
  }

  .ob-seed-progress-row--current .ob-seed-progress-prefix--planning {
    color: var(--text);
  }

  .ob-seed-progress-path {
    display: inline-flex;
    align-items: center;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
    color: var(--accent);
    text-align: left;
    max-width: 100%;
  }

  .ob-seed-progress-path:hover {
    text-decoration: underline;
  }

  .ob-seed-progress-detail {
    display: block;
    width: 100%;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-2);
  }

  .ob-seed-progress-wait {
    color: var(--text-2);
    letter-spacing: 0.12em;
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

  .ob-prof-people-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ob-prof-person-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.45rem 0.65rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
  }

  .ob-prof-person-lead {
    color: var(--accent);
    opacity: 0.85;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .ob-prof-person-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .ob-prof-person-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ob-prof-person-email {
    font-size: 0.6875rem;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ob-prof-placeholder {
    margin: 1rem 0 0;
    font-size: 0.875rem;
    color: var(--text-2);
  }
</style>
