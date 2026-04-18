<script lang="ts">
  /**
   * Wiki seeding onboarding: progress rows + wiki chips; shares scroll behavior with profiling view.
   */
  import { Check, Mail } from 'lucide-svelte'
  import type { AgentConversationViewProps, ConversationScrollApi } from '../agentConversationViewTypes.js'
  import WikiFileName from '../WikiFileName.svelte'
  import OnboardingActivityTranscriptShell from './OnboardingActivityTranscriptShell.svelte'
  import OnboardingLocalWikiLead from './OnboardingLocalWikiLead.svelte'
  import { seedingLeadCopy } from './onboardingLeadCopy.js'
  import { buildSeedingProgressUi, extractProfilingResources, onboardingActivityLine } from './profilingResources.js'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenEmail,
    streamingWrite = null,
  }: AgentConversationViewProps = $props()

  let shell = $state<ConversationScrollApi | undefined>()

  const seedingProgress = $derived(buildSeedingProgressUi(messages, streaming))
  const activity = $derived(onboardingActivityLine(messages, streaming, 'seeding'))
  const resources = $derived(extractProfilingResources(messages))

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
    <OnboardingLocalWikiLead {...seedingLeadCopy} />

    {#if seedingProgress.rows.length > 0 || seedingProgress.planning}
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

    {#if resources.wikiPaths.length > 0}
      <section class="ob-prof-section" aria-labelledby="ob-prof-wiki-heading">
        <h2 id="ob-prof-wiki-heading" class="ob-prof-section-title">Pages</h2>
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

    {#if !streaming && messages.length === 0}
      <p class="ob-prof-placeholder">Starting…</p>
    {/if}
  {/snippet}
</OnboardingActivityTranscriptShell>

<style>
  @import './onboardingActivityTranscript.css';
</style>
