<script lang="ts">
  // Re-export the shared event type from the (already-ported) DayEvents location.
  import type { CalendarEvent } from '@tw-components/DayEvents.svelte'
  import WikiFileName from '@tw-components/WikiFileName.svelte'
  import { formatDate } from '@client/lib/formatDate.js'
  import {
    formatCalendarEventWhen,
    calendarSourceLabel,
  } from '@client/lib/calendarEventDetailFormat.js'
  import {
    stripHtmlNotesToPlain,
    extractHttpUrls,
    extractMeetingIds,
  } from '@client/lib/calendarNotes.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  type WikiR = { type: 'wiki'; path: string; excerpt: string }
  type EmailR = {
    type: 'email'
    id: string
    from: string
    subject: string
    date: string
    snippet: string
  }

  type WhoPerson = {
    primaryAddress?: string
    displayName?: string
    name?: string
    wikiPath?: string
  }

  let {
    event,
    onOpenWiki,
    onOpenEmail,
  }: {
    event: CalendarEvent
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
  } = $props()

  const notesPlain = $derived(
    event.description?.trim() ? stripHtmlNotesToPlain(event.description) : '',
  )

  const linkUrls = $derived.by(() => {
    const raw = event.description ?? ''
    const fromDesc = extractHttpUrls(raw)
    const loc = event.location?.trim()
    if (loc && /^https?:\/\//i.test(loc) && !fromDesc.includes(loc)) {
      return [loc, ...fromDesc]
    }
    return fromDesc
  })

  const locationIsUrl = $derived(
    !!(event.location?.trim() && /^https?:\/\//i.test(event.location.trim())),
  )

  let relatedLoading = $state(false)
  let relatedError = $state<string | null>(null)
  let relatedWiki = $state<WikiR[]>([])
  let relatedEmails = $state<EmailR[]>([])
  let relatedPeople = $state<WhoPerson[]>([])

  const relatedContextLatest = createAsyncLatest({ abortPrevious: true })

  $effect(() => {
    const ev = event
    const { token, signal } = relatedContextLatest.begin()
    relatedError = null
    relatedWiki = []
    relatedEmails = []
    relatedPeople = []

    const allText = [ev.description ?? '', ev.location ?? ''].join('\n')
    const meetingIds = extractMeetingIds(allText)

    const params = new URLSearchParams()
    params.set('eventId', ev.id)
    if (meetingIds.length) params.set('meetingIds', meetingIds.join(','))

    relatedLoading = true
    void (async () => {
      try {
        const res = await fetch(`/api/calendar/related?${params.toString()}`, { signal })
        if (relatedContextLatest.isStale(token)) return
        if (!res.ok) throw new Error(`${res.status}`)
        const data = (await res.json()) as {
          emails?: EmailR[]
          wiki?: WikiR[]
          people?: WhoPerson[]
        }
        if (relatedContextLatest.isStale(token)) return
        relatedEmails = data.emails ?? []
        relatedWiki = data.wiki ?? []
        relatedPeople = data.people ?? []
      } catch (e) {
        if (relatedContextLatest.isStale(token) || isAbortError(e)) return
        relatedError = 'Could not load related context.'
      } finally {
        if (!relatedContextLatest.isStale(token)) relatedLoading = false
      }
    })()

    return () => {
      relatedContextLatest.begin()
    }
  })

  const hasRelated = $derived(
    relatedLoading ||
      relatedError != null ||
      relatedWiki.length > 0 ||
      relatedEmails.length > 0 ||
      relatedPeople.length > 0,
  )

  function personLabel(p: WhoPerson): string {
    const n = p.displayName ?? p.name
    const a = p.primaryAddress
    if (n && a) return `${n} · ${a}`
    return n ?? a ?? 'Contact'
  }

  /** Card-like related-row button shared between people, messages, and wiki blocks. */
  const relatedBtnBase =
    'm-0 flex w-full cursor-pointer flex-col items-start gap-[2px] border border-border bg-surface-2 px-2.5 py-2 text-left text-inherit [font:inherit] transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-surface-3'
</script>

<article class="ced max-w-[560px] px-1 pb-4 pt-1">
  <h2 class="ced-title m-0 mb-2.5 text-lg font-semibold leading-tight text-foreground">{event.title}</h2>
  <p
    class="ced-badge mb-4 mt-0 inline-block bg-[var(--custom-bg,var(--bg-3))] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--custom-text,var(--text-2))]"
    data-source={event.source}
    style={event.color ? `--custom-bg: color-mix(in srgb, ${event.color} 22%, var(--bg-3)); --custom-text: var(--text);` : ''}
  >
    {calendarSourceLabel(event.source)}
  </p>

  <dl class="ced-dl m-0 flex flex-col gap-[14px]">
    <div class="ced-row m-0 grid grid-cols-[88px_1fr] items-start gap-x-[14px] gap-y-2.5">
      <dt class="m-0 text-xs font-semibold uppercase tracking-[0.04em] text-muted">When</dt>
      <dd class="m-0 text-sm leading-snug text-foreground">{formatCalendarEventWhen(event)}</dd>
    </div>
    {#if event.location?.trim()}
      <div class="ced-row m-0 grid grid-cols-[88px_1fr] items-start gap-x-[14px] gap-y-2.5">
        <dt class="m-0 text-xs font-semibold uppercase tracking-[0.04em] text-muted">Where</dt>
        <dd class="m-0 text-sm leading-snug text-foreground">
          {#if locationIsUrl}
            <a
              class="ced-link text-accent underline [text-underline-offset:2px] [word-break:break-all] hover:text-foreground"
              href={event.location!.trim()}
              target="_blank"
              rel="noopener noreferrer"
            >{event.location!.trim()}</a>
          {:else}
            {event.location}
          {/if}
        </dd>
      </div>
    {/if}
    {#if linkUrls.length > 0}
      <div class="ced-row ced-links-row m-0 grid grid-cols-[88px_1fr] items-start gap-x-[14px] gap-y-2.5">
        <dt class="m-0 text-xs font-semibold uppercase tracking-[0.04em] text-muted">Links</dt>
        <dd class="m-0 text-sm leading-snug text-foreground">
          <ul class="ced-link-list m-0 pl-[1.1em] text-[13px] [&>li]:my-1">
            {#each linkUrls as href (href)}
              <li>
                <a
                  class="ced-link text-accent underline [text-underline-offset:2px] [word-break:break-all] hover:text-foreground"
                  {href}
                  target="_blank"
                  rel="noopener noreferrer"
                >{href}</a>
              </li>
            {/each}
          </ul>
        </dd>
      </div>
    {/if}
    {#if notesPlain}
      <div class="ced-row ced-notes m-0 grid grid-cols-[88px_1fr] items-start gap-x-[14px] gap-y-2.5">
        <dt class="m-0 pt-0.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted">Notes</dt>
        <dd
          class="ced-desc m-0 whitespace-pre-wrap text-[13px] leading-snug text-muted [word-break:break-word]"
        >{notesPlain}</dd>
      </div>
    {/if}
  </dl>

  {#if hasRelated}
    <section class="ced-related mt-[22px] border-t border-border pt-4" aria-label="Related context">
      <h3 class="ced-related-title m-0 mb-1.5 text-[13px] font-semibold uppercase tracking-[0.04em] text-foreground">Related context</h3>
      <p class="ced-related-hint m-0 mb-3 text-[11px] leading-tight text-muted">Related notes and messages from your wiki and inbox.</p>

      {#if relatedLoading}
        <p class="ced-related-muted m-0 text-xs text-muted">Loading…</p>
      {:else if relatedError}
        <p class="ced-related-err m-0 text-xs text-[#f87171]">{relatedError}</p>
      {:else}
        {#if relatedPeople.length > 0}
          <div class="ced-block mb-3.5 last:mb-0">
            <div class="ced-block-label mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">Contacts</div>
            <ul class="ced-mini-list m-0 flex list-none flex-col gap-2 p-0">
              {#each relatedPeople as p, i (p.primaryAddress ?? i)}
                <li>
                  {#if p.wikiPath && onOpenWiki}
                    <button
                      type="button"
                      class="ced-person-btn {relatedBtnBase} [&_.wfn-title-row]:text-[13px]"
                      onclick={() => onOpenWiki(p.wikiPath!)}
                    >
                      <WikiFileName path={p.wikiPath} />
                      <span class="ced-person-email text-[11px] text-muted">{p.primaryAddress}</span>
                    </button>
                  {:else}
                    <span class="ced-mini-item text-[13px] leading-tight text-foreground">{personLabel(p)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if relatedEmails.length > 0}
          <div class="ced-block mb-3.5 last:mb-0">
            <div class="ced-block-label mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">Messages</div>
            <ul class="ced-mini-list m-0 flex list-none flex-col gap-2 p-0">
              {#each relatedEmails as m (m.id)}
                <li>
                  {#if onOpenEmail}
                    <button
                      type="button"
                      class="ced-msg-btn {relatedBtnBase}"
                      onclick={() => onOpenEmail(m.id, m.subject, m.from)}
                    >
                      <span class="ced-msg-subj text-[13px] font-semibold text-foreground">{m.subject}</span>
                      <span class="ced-msg-meta text-[11px] text-muted">{m.from} · {formatDate(m.date)}</span>
                      {#if m.snippet}
                        <span
                          class="ced-msg-snippet overflow-hidden text-[11px] leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                        >{m.snippet}</span>
                      {/if}
                    </button>
                  {:else}
                    <span class="ced-msg-subj text-[13px] font-semibold text-foreground">{m.subject}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if relatedWiki.length > 0}
          <div class="ced-block mb-3.5 last:mb-0">
            <div class="ced-block-label mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">Docs</div>
            <ul class="ced-mini-list m-0 flex list-none flex-col gap-2 p-0">
              {#each relatedWiki as w (w.path)}
                <li>
                  {#if onOpenWiki}
                    <button
                      type="button"
                      class="ced-wiki-btn {relatedBtnBase} [&_.wfn-title-row]:text-[13px]"
                      onclick={() => onOpenWiki(w.path)}
                    >
                      <WikiFileName path={w.path} />
                      {#if w.excerpt}
                        <span
                          class="ced-wiki-excerpt overflow-hidden text-[11px] leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                        >{w.excerpt}</span>
                      {/if}
                    </button>
                  {:else}
                    <WikiFileName path={w.path} />
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if !relatedLoading && relatedPeople.length === 0 && relatedEmails.length === 0 && relatedWiki.length === 0}
          <p class="ced-related-muted m-0 text-xs text-muted">No matching contacts or search hits for this title.</p>
        {/if}
      {/if}
    </section>
  {/if}
</article>

<style>
  /* Travel/personal source-specific tints depend on `data-source` attribute selectors. */
  .ced-badge[data-source='travel'] {
    background: var(--custom-bg, color-mix(in srgb, #f59e0b 22%, var(--bg-3)));
    color: var(--custom-text, var(--text));
  }

  .ced-badge[data-source='personal'] {
    background: var(--custom-bg, color-mix(in srgb, var(--accent) 18%, var(--bg-3)));
    color: var(--custom-text, var(--text));
  }
</style>
