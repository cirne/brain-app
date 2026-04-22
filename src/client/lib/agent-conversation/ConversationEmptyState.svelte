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

<div class="empty-state">
  <div class="empty-intro">
    <p>Ask anything about your docs, email, or calendar.</p>
    <p class="hint">Use <kbd>@</kbd> to reference docs in this app.</p>
  </div>
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    min-height: 0;
    color: var(--text-2);
    font-size: 14px;
    gap: 8px;
    padding-bottom: 8px;
    box-sizing: border-box;
  }

  .empty-intro {
    text-align: center;
    width: 100%;
  }

  .hint {
    font-size: 12px;
    opacity: 0.7;
  }

  .hint kbd {
    background: var(--bg-3);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: inherit;
    font-size: 12px;
  }
</style>
