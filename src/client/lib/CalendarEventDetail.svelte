<script lang="ts">
  import type { CalendarEvent } from './DayEvents.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import { formatDate } from './formatDate.js'
  import {
    formatCalendarEventWhen,
    calendarSourceLabel,
  } from './calendarEventDetailFormat.js'
  import {
    stripHtmlNotesToPlain,
    extractHttpUrls,
    extractMeetingIds,
  } from './calendarNotes.js'

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

  $effect(() => {
    const ev = event
    let cancelled = false
    relatedError = null
    relatedWiki = []
    relatedEmails = []
    relatedPeople = []

    // Extract meeting IDs from description + location URLs
    const allText = [ev.description ?? '', ev.location ?? ''].join('\n')
    const meetingIds = extractMeetingIds(allText)

    const params = new URLSearchParams()
    params.set('eventId', ev.id)
    if (meetingIds.length) params.set('meetingIds', meetingIds.join(','))

    relatedLoading = true
    void (async () => {
      try {
        const res = await fetch(`/api/calendar/related?${params.toString()}`)
        if (cancelled) return
        if (!res.ok) throw new Error(`${res.status}`)
        const data = (await res.json()) as {
          emails?: EmailR[]
          wiki?: WikiR[]
          people?: WhoPerson[]
        }
        relatedEmails = data.emails ?? []
        relatedWiki = data.wiki ?? []
        relatedPeople = data.people ?? []
      } catch {
        if (!cancelled) relatedError = 'Could not load related context.'
      } finally {
        if (!cancelled) relatedLoading = false
      }
    })()

    return () => {
      cancelled = true
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
</script>

<article class="ced">
  <h2 class="ced-title">{event.title}</h2>
  <p class="ced-badge" data-source={event.source}>{calendarSourceLabel(event.source)}</p>

  <dl class="ced-dl">
    <div class="ced-row">
      <dt>When</dt>
      <dd>{formatCalendarEventWhen(event)}</dd>
    </div>
    {#if event.location?.trim()}
      <div class="ced-row">
        <dt>Where</dt>
        <dd>
          {#if locationIsUrl}
            <a
              class="ced-link"
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
      <div class="ced-row ced-links-row">
        <dt>Links</dt>
        <dd>
          <ul class="ced-link-list">
            {#each linkUrls as href (href)}
              <li>
                <a class="ced-link" {href} target="_blank" rel="noopener noreferrer">{href}</a>
              </li>
            {/each}
          </ul>
        </dd>
      </div>
    {/if}
    {#if notesPlain}
      <div class="ced-row ced-notes">
        <dt>Notes</dt>
        <dd class="ced-desc">{notesPlain}</dd>
      </div>
    {/if}
  </dl>

  {#if hasRelated}
    <section class="ced-related" aria-label="Related context">
      <h3 class="ced-related-title">Related context</h3>
      <p class="ced-related-hint">Related notes and messages from your wiki and inbox.</p>

      {#if relatedLoading}
        <p class="ced-related-muted">Loading…</p>
      {:else if relatedError}
        <p class="ced-related-err">{relatedError}</p>
      {:else}
        {#if relatedPeople.length > 0}
          <div class="ced-block">
            <div class="ced-block-label">Contacts</div>
            <ul class="ced-mini-list">
              {#each relatedPeople as p, i (p.primaryAddress ?? i)}
                <li>
                  {#if p.wikiPath && onOpenWiki}
                    <button
                      type="button"
                      class="ced-person-btn"
                      onclick={() => onOpenWiki(p.wikiPath!)}
                    >
                      <WikiFileName path={p.wikiPath} />
                      <span class="ced-person-email">{p.primaryAddress}</span>
                    </button>
                  {:else}
                    <span class="ced-mini-item">{personLabel(p)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if relatedEmails.length > 0}
          <div class="ced-block">
            <div class="ced-block-label">Messages</div>
            <ul class="ced-mini-list">
              {#each relatedEmails as m (m.id)}
                <li>
                  {#if onOpenEmail}
                    <button
                      type="button"
                      class="ced-msg-btn"
                      onclick={() => onOpenEmail(m.id, m.subject, m.from)}
                    >
                      <span class="ced-msg-subj">{m.subject}</span>
                      <span class="ced-msg-meta">{m.from} · {formatDate(m.date)}</span>
                      {#if m.snippet}
                        <span class="ced-msg-snippet">{m.snippet}</span>
                      {/if}
                    </button>
                  {:else}
                    <span class="ced-msg-subj">{m.subject}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if relatedWiki.length > 0}
          <div class="ced-block">
            <div class="ced-block-label">Docs</div>
            <ul class="ced-mini-list">
              {#each relatedWiki as w (w.path)}
                <li>
                  {#if onOpenWiki}
                    <button type="button" class="ced-wiki-btn" onclick={() => onOpenWiki(w.path)}>
                      <WikiFileName path={w.path} />
                      {#if w.excerpt}
                        <span class="ced-wiki-excerpt">{w.excerpt}</span>
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
          <p class="ced-related-muted">No matching contacts or search hits for this title.</p>
        {/if}
      {/if}
    </section>
  {/if}
</article>

<style>
  .ced {
    padding: 4px 4px 16px;
    max-width: 560px;
  }

  .ced-title {
    margin: 0 0 10px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .ced-badge {
    display: inline-block;
    margin: 0 0 16px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-2);
  }

  .ced-badge[data-source='travel'] {
    background: color-mix(in srgb, #f59e0b 22%, var(--bg-3));
    color: var(--text);
  }

  .ced-badge[data-source='personal'] {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-3));
    color: var(--text);
  }

  .ced-dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .ced-row {
    margin: 0;
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 10px 14px;
    align-items: start;
  }

  .ced-row dt {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .ced-row dd {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text);
  }

  .ced-notes dt {
    padding-top: 2px;
  }

  .ced-desc {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    color: var(--text-2);
  }

  .ced-link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }

  .ced-link:hover {
    color: var(--text);
  }

  .ced-link-list {
    margin: 0;
    padding-left: 1.1em;
    font-size: 13px;
  }

  .ced-link-list li {
    margin: 4px 0;
  }

  .ced-related {
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .ced-related-title {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .ced-related-hint {
    margin: 0 0 12px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-2);
  }

  .ced-related-muted,
  .ced-related-err {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }

  .ced-related-err {
    color: #f87171;
  }

  .ced-block {
    margin-bottom: 14px;
  }

  .ced-block:last-child {
    margin-bottom: 0;
  }

  .ced-block-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
  }

  .ced-mini-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ced-mini-item {
    font-size: 13px;
    color: var(--text);
    line-height: 1.35;
  }

  .ced-person-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-2);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .ced-person-btn:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--bg-3);
  }

  .ced-person-btn :global(.wfn-title-row) {
    font-size: 13px;
  }

  .ced-person-email {
    font-size: 11px;
    color: var(--text-2);
  }

  .ced-msg-btn,
  .ced-wiki-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-2);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .ced-msg-btn:hover,
  .ced-wiki-btn:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--bg-3);
  }

  .ced-msg-subj {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .ced-msg-meta {
    font-size: 11px;
    color: var(--text-2);
  }

  .ced-msg-snippet {
    font-size: 11px;
    color: var(--text-2);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ced-wiki-btn :global(.wfn-title-row) {
    font-size: 13px;
  }

  .ced-wiki-excerpt {
    font-size: 11px;
    color: var(--text-2);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
