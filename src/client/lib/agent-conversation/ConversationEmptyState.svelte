<script lang="ts">
  import { onMount } from 'svelte'
  import { ensureBrainTtsAutoplayInUserGesture } from '../brainTtsAudio.js'

  let {
    onOpenEmail: _onOpenEmail,
    onOpenFullInbox: _onOpenFullInbox,
    onSwitchToCalendar: _onSwitchToCalendar,
    onOpenWikiAbout,
    hearReplies = false,
    onHearRepliesChange,
  }: {
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    /** Opens the “what is a wiki” help (`hub-wiki-about`) in the detail stack. */
    onOpenWikiAbout?: () => void
    hearReplies?: boolean
    onHearRepliesChange?: (_value: boolean) => void
  } = $props()

  let isMobile = $state(false)

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      isMobile = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  })

  function toggleHearReplies(checked: boolean) {
    onHearRepliesChange?.(checked)
    if (checked) {
      void ensureBrainTtsAutoplayInUserGesture()
    }
  }
</script>

<div
  class="box-border flex min-h-0 flex-col items-stretch justify-center gap-2 pb-2 text-sm text-muted"
>
  <div class="w-full text-center">
    <p>Ask anything about your docs, email, or calendar.</p>
    <p class="text-xs opacity-70">
      Use <kbd class="rounded border border-border bg-surface-3 px-1.5 py-px font-inherit text-xs">@</kbd> to reference
      docs in{' '}
      {#if onOpenWikiAbout}
        <button type="button" class="wiki-about-link" onclick={onOpenWikiAbout}>your wiki</button>.
      {:else}
        your wiki.
      {/if}
    </p>
  </div>

  {#if isMobile && onHearRepliesChange}
    <div class="hear-replies-row">
      <label class="hear-replies-control">
        <span class="hear-replies-title">Audio Conversation</span>
        <span class="hear-replies-switch">
          <input
            type="checkbox"
            class="hear-replies-input"
            checked={hearReplies}
            onchange={(e) => toggleHearReplies((e.currentTarget as HTMLInputElement).checked)}
          />
          <span class="hear-replies-track" aria-hidden="true">
            <span class="hear-replies-thumb"></span>
          </span>
        </span>
      </label>
      <p class="hear-replies-hint text-xs opacity-70">
        Summarize my response with audio
      </p>
    </div>
  {/if}
</div>

<style>
  .wiki-about-link {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: inherit;
    line-height: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 35%, transparent);
    text-underline-offset: 2px;
  }
  .wiki-about-link:hover {
    text-decoration-color: var(--accent);
  }
  .wiki-about-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .hear-replies-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    max-width: 20rem;
    margin-inline: auto;
    text-align: center;
  }
  /* iOS Control Center–style switch: row label + pill track */
  .hear-replies-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    max-width: 17.5rem;
    padding: 0.125rem 0;
    user-select: none;
    cursor: pointer;
  }
  .hear-replies-title {
    color: var(--text);
    font-weight: 500;
    text-align: start;
    flex: 1;
    min-width: 0;
  }
  .hear-replies-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }
  .hear-replies-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
    opacity: 0;
  }
  .hear-replies-input:focus-visible + .hear-replies-track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .hear-replies-track {
    position: relative;
    width: 3.125rem; /* 50px */
    height: 1.875rem; /* 30px */
    border-radius: 100px;
    background: color-mix(in srgb, var(--text) 20%, var(--bg-2));
    transition: background 0.2s ease;
  }
  .hear-replies-input:checked + .hear-replies-track {
    background: #34c759; /* iOS system green (light) */
  }
  @media (prefers-color-scheme: dark) {
    .hear-replies-input:checked + .hear-replies-track {
      background: #30d158; /* iOS green (dark) */
    }
  }
  .hear-replies-thumb {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    width: 1.625rem; /* 26px */
    height: 1.625rem;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0.125rem 0.25rem rgba(0, 0, 0, 0.12),
      0 0.125rem 0.0625rem rgba(0, 0, 0, 0.08);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hear-replies-input:checked + .hear-replies-track .hear-replies-thumb {
    transform: translateX(1.25rem); /* 50 - 2 - 26 - 2 = 20px */
  }
  .hear-replies-hint {
    margin: 0;
    padding: 0 0.5rem;
    line-height: 1.35;
  }
</style>
