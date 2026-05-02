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

<div class="box-border flex w-full justify-center pb-2">
  <div
    class="max-w-md text-balance text-center text-sm leading-relaxed text-muted px-[length:var(--chat-transcript-px)]"
  >
    <p>Ask anything about your docs, email, or calendar.</p>
    <p class="mt-1.5 text-xs opacity-70">
      Use <kbd class="rounded border border-border bg-surface-3 px-1.5 py-px font-[inherit] text-xs">@</kbd> to reference docs
      in{' '}
      {#if onOpenWikiAbout}
        <button
          type="button"
          class="wiki-about-link m-0 cursor-pointer border-none bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] text-accent underline underline-offset-2 [text-decoration-color:color-mix(in_srgb,var(--accent)_35%,transparent)] hover:[text-decoration-color:var(--accent)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onclick={onOpenWikiAbout}
        >your wiki</button>.
      {:else}
        your wiki.
      {/if}
    </p>
  </div>
</div>
