<script lang="ts">
  import { onMount } from 'svelte'
  import CalendarPreviewCard from '../cards/CalendarPreviewCard.svelte'
  import InboxListPreviewCard from '../cards/InboxListPreviewCard.svelte'
  import { subscribe } from '../app/appEvents.js'
  import { inboxRowsToPreviewItems } from '../../../server/lib/ripmailInboxFlatten.js'
  import type { CalendarEventLite, InboxListItemPreview } from '../cards/contentCards.js'

  let {
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
  }: {
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
  } = $props()

  let loading = $state(false)
  let inboxRows = $state<InboxListItemPreview[]>([])
  let calendarEvents = $state<CalendarEventLite[]>([])
  let dayKey = $state(new Date().toISOString().slice(0, 10))

  async function load() {
    loading = true
    const todayYmd = new Date().toISOString().slice(0, 10)
    dayKey = todayYmd
    try {
      const [inboxRes, calRes] = await Promise.all([
        fetch('/api/inbox'),
        fetch(`/api/calendar?start=${todayYmd}&end=${todayYmd}`),
      ])
      const inboxJson = inboxRes.ok ? await inboxRes.json() : []
      const rows = Array.isArray(inboxJson) ? inboxJson : []
      inboxRows = inboxRowsToPreviewItems(rows)

      const calData = calRes.ok ? await calRes.json() : { events: [] }
      calendarEvents = Array.isArray(calData.events) ? calData.events : []
    } catch {
      inboxRows = []
      calendarEvents = []
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void load()
    return subscribe((e) => {
      if (e.type === 'sync:completed') void load()
    })
  })
</script>

<div class="empty-state">
  <div class="empty-intro">
    <p>Ask anything about your docs, email, or calendar.</p>
    <p class="hint">Use <kbd>@</kbd> to reference docs in this app.</p>
  </div>
  {#if loading}
    <p class="empty-loading">Loading calendar and inbox…</p>
  {:else}
    <div class="empty-previews">
      <CalendarPreviewCard
        start={dayKey}
        end={dayKey}
        events={calendarEvents}
        onOpenCalendar={(date) => onSwitchToCalendar?.(date)}
        onOpenCalendarEvent={(date, eventId) => onSwitchToCalendar?.(date, eventId)}
      />
      <InboxListPreviewCard
        items={inboxRows}
        totalCount={inboxRows.length}
        onOpenEmail={(id, subject, from) => onOpenEmail?.(id, subject, from)}
        onOpenFullInbox={onOpenFullInbox}
      />
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    min-height: 100%;
    color: var(--text-2);
    font-size: 14px;
    gap: 8px;
    padding-bottom: 24px;
    box-sizing: border-box;
  }

  .empty-intro {
    text-align: center;
    width: 100%;
  }

  .empty-loading {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--text-2);
    opacity: 0.75;
    text-align: center;
  }

  .empty-previews {
    width: 100%;
    max-width: 800px;
    margin: 12px auto 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-self: center;
  }

  .empty-previews :global(.inbox-list-card),
  .empty-previews :global(.calendar-card) {
    margin-left: 0;
    margin-right: 0;
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
