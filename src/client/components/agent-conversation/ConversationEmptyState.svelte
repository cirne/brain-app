<script lang="ts">
  let {
    onOpenEmail: _onOpenEmail,
    onOpenFullInbox: _onOpenFullInbox,
    onSwitchToCalendar: _onSwitchToCalendar,
    onOpenWikiAbout,
  }: {
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    /** Opens wiki at vault landing (`index.md` / resolved root), same as the Wiki nav control. */
    onOpenWikiAbout?: () => void
  } = $props()
</script>

<div
  class="box-border flex flex-col items-stretch justify-center gap-2 pb-2 text-sm text-muted"
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
</style>
