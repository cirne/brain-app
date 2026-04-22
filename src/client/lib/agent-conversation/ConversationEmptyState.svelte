<script lang="ts">
  import { onMount } from 'svelte'
  import { subscribe } from '../app/appEvents.js'

  let {
    onOpenEmail: _onOpenEmail,
    onOpenFullInbox: _onOpenFullInbox,
    onSwitchToCalendar: _onSwitchToCalendar,
  }: {
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
  } = $props()

  onMount(() => {
    return subscribe((_e) => {
      // ignore
    })
  })
</script>

<div
  class="box-border flex min-h-0 flex-col items-stretch justify-center gap-2 pb-2 text-sm text-muted"
>
  <div class="w-full text-center">
    <p>Ask anything about your docs, email, or calendar.</p>
    <p class="text-xs opacity-70">
      Use <kbd class="rounded border border-border bg-surface-3 px-1.5 py-px font-inherit text-xs">@</kbd> to reference
      docs in this app.
    </p>
  </div>
</div>
