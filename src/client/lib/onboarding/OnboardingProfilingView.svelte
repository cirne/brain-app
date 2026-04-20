<script lang="ts">
  /**
   * Onboarding profile build: activity + referenced paths/mail; streamed `me.md` at bottom as assistant message.
   */
  import { Mail, User } from 'lucide-svelte'
  import type { AgentConversationViewProps, ConversationScrollApi } from '../agentConversationViewTypes.js'
  import WikiFileName from '../WikiFileName.svelte'
  import { getToolIcon } from '../toolIcons.js'
  import { getToolUiPolicy } from '../agentUtils.js'
  import { renderMarkdown } from '../markdown.js'
  import OnboardingActivityTranscriptShell from './OnboardingActivityTranscriptShell.svelte'
  import OnboardingLocalWikiLead from './OnboardingLocalWikiLead.svelte'
  import { profilingLeadCopy } from './onboardingLeadCopy.js'
  import {
    buildProfilingTranscriptEvents,
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
    streamingWrite = null,
  }: AgentConversationViewProps = $props()

  let shell = $state<ConversationScrollApi | undefined>()

  const profilingTranscriptEvents = $derived(buildProfilingTranscriptEvents(messages))

  const peopleBlock = $derived(extractProfilingPeople(messages))
  const activity = $derived(onboardingActivityLine(messages, streaming, 'profiling'))
  const resources = $derived(extractProfilingResources(messages))

  const profileDraftPreview = $derived.by(() => {
    const sw = streamingWrite
    if (sw?.body?.trim() && isProfilingMeMdPath(sw.path)) return sw.body
    return extractLastMeMdWriteContent(messages) ?? ''
  })

  const profileDraftStreaming = $derived(
    Boolean(
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

  export function scrollToBottom() {
    shell?.scrollToBottom()
  }

  export function scrollToBottomIfFollowing() {
    shell?.scrollToBottomIfFollowing()
  }
</script>

<OnboardingActivityTranscriptShell
  bind:this={shell}
  {messages}
  {streaming}
  {streamingWrite}
>
  {#snippet children({ reduceMotion })}
    <OnboardingLocalWikiLead {...profilingLeadCopy} hideTitle />

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

    {#each profilingTranscriptEvents as event, i (event.type === 'email' ? event.toolId : `txt-${i}`)}
      {#if event.type === 'text'}
        <div class="ob-prof-chat-msg" role="article">
          <div class="ob-prof-msg-label">Assistant</div>
          <div class="ob-prof-msg-body markdown">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(event.content)}
          </div>
        </div>
      {:else}
        <div class="ob-prof-inline-mail" role="article">
          <button
            type="button"
            class="ob-prof-mail-row"
            class:ob-prof-mail-row--pending={!event.done}
            onclick={() => onOpenEmail?.(event.row.id, event.row.subject, event.row.from)}
          >
            <span class="ob-prof-mail-lead" aria-hidden="true">
              <Mail size={12} />
            </span>
            <span class="ob-prof-mail-body">
              <span class="ob-prof-mail-subject">
                {event.row.subject.trim() || (event.done ? '(No subject)' : 'Reading message…')}
              </span>
              {#if event.row.from.trim()}
                <span class="ob-prof-mail-meta">{event.row.from}</span>
              {/if}
              {#if event.row.snippet.trim()}
                <span class="ob-prof-mail-snippet">{event.row.snippet}</span>
              {/if}
            </span>
          </button>
        </div>
      {/if}
    {/each}

    {#if peopleBlock.people.length > 0 || peopleBlock.peopleOverflow > 0}
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
        {#if resources.wikiOverflow > 0}
          <p class="ob-prof-overflow">+{resources.wikiOverflow} more</p>
        {/if}
      </section>
    {/if}

    {#if profileDraftPreview.trim().length > 0}
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
  {/snippet}
</OnboardingActivityTranscriptShell>

<style>
  @import './onboardingActivityTranscript.css';
</style>
