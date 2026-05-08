<script lang="ts">
  import type { BrainAccessLogRow } from '@client/lib/brainAccessPolicyGrouping.js'
  import { parseBrainQueryFilterNotes } from '@client/lib/brainQueryFilterNotes.js'

  type Props = {
    entries: BrainAccessLogRow[]
    /** Max rows before showing overflow hint */
    limit?: number
    resolveAskerHandle?: (_askerId: string) => string | undefined
    showViewAll?: boolean
    onViewAll?: () => void
  }

  let {
    entries,
    limit = 10,
    resolveAskerHandle,
    showViewAll = false,
    onViewAll,
  }: Props = $props()

  function formatRelative(ms: number): string {
    const d = new Date(ms)
    if (isNaN(d.getTime())) return String(ms)
    const diffSec = Math.floor((Date.now() - ms) / 1000)
    if (diffSec < 60) return 'Just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD}d ago`
    return d.toLocaleDateString()
  }

  function formatDuration(ms: number | null): string | null {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return null
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'ok':
        return 'OK'
      case 'filter_blocked':
        return 'Filtered'
      case 'early_rejected':
        return 'Declined'
      case 'denied_no_grant':
        return 'Denied'
      case 'error':
        return 'Error'
      default:
        return status
    }
  }

  function statusTone(status: string): string {
    switch (status) {
      case 'ok':
        return 'bg-surface-3 text-foreground'
      case 'filter_blocked':
        return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
      case 'early_rejected':
        return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
      case 'denied_no_grant':
        return 'bg-muted text-muted'
      case 'error':
        return 'bg-red-500/15 text-red-800 dark:text-red-200'
      default:
        return 'bg-surface-3 text-foreground'
    }
  }

  function normalizedAnswer(s: string | null | undefined): string {
    return (s ?? '').trim()
  }

  function returnedSummary(e: BrainAccessLogRow): string | null {
    const fin = normalizedAnswer(e.finalAnswer)
    if (fin.length > 0) return fin
    if (e.status === 'denied_no_grant') {
      return 'No answer — access was not granted for this attempt.'
    }
    if (e.status === 'error') {
      return null
    }
    return null
  }

  const visible = $derived(entries.slice(0, limit))
  const overflow = $derived(entries.length > limit)
</script>

{#if visible.length === 0}
  <p class="m-0 text-[0.8125rem] text-muted">No activity for this policy yet.</p>
{:else}
  <ul class="m-0 flex list-none flex-col gap-0 p-0">
    {#each visible as e (e.id)}
      {@const handle = resolveAskerHandle?.(e.askerId) ?? e.askerId}
      {@const dur = formatDuration(e.durationMs)}
      {@const parsedNotes = parseBrainQueryFilterNotes(e.filterNotes)}
      {@const draft = normalizedAnswer(e.draftAnswer ?? null)}
      {@const finalT = normalizedAnswer(e.finalAnswer)}
      {@const showDraft =
        draft.length > 0 && (draft !== finalT || parsedNotes.redactions.length > 0)}
      <li
        class="border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] py-3 text-[0.8125rem] last:border-b-0"
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          <span class="font-medium text-foreground">{formatRelative(e.createdAtMs)}</span>
          <span aria-hidden="true">·</span>
          <span class="font-mono text-foreground">@{handle}</span>
          {#if dur}
            <span aria-hidden="true">·</span>
            <span>{dur}</span>
          {/if}
          <span
            class={`rounded-full px-1.5 py-px text-[0.625rem] font-bold uppercase tracking-wide ${statusTone(e.status)}`}
            >{statusLabel(e.status)}</span
          >
        </div>

        <div class="mt-2 flex flex-col gap-2">
          <div>
            <div class="mb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
              Question
            </div>
            <div
              class="rounded-md border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-3/80 px-2.5 py-2 whitespace-pre-wrap text-foreground"
            >
              {e.question.trim() || '—'}
            </div>
          </div>

          <div>
            <div class="mb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
              Returned to collaborator
            </div>
            {#if returnedSummary(e) != null}
              <div
                class="rounded-md border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-3/80 px-2.5 py-2 whitespace-pre-wrap text-foreground"
              >
                {returnedSummary(e)}
              </div>
            {:else if e.status === 'error' && parsedNotes.plainText}
              <div
                class="rounded-md border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-3/80 px-2.5 py-2 whitespace-pre-wrap text-foreground"
              >
                <span class="text-muted">No answer returned.</span>
                {' '}
                <span class="text-destructive">{parsedNotes.plainText}</span>
              </div>
            {:else}
              <div class="text-muted">—</div>
            {/if}
          </div>

          {#if showDraft}
            <details class="group rounded-md border border-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-surface-2/50">
              <summary
                class="cursor-pointer list-none px-2.5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted marker:content-none [&::-webkit-details-marker]:hidden"
              >
                <span class="underline-offset-2 group-open:underline">Assistant reply before sharing</span>
              </summary>
              <div
                class="border-t border-[color-mix(in_srgb,var(--border)_40%,transparent)] px-2.5 pb-2 whitespace-pre-wrap text-foreground"
              >
                {draft}
              </div>
            </details>
          {/if}

          {#if parsedNotes.redactions.length > 0 || (parsedNotes.plainText && e.status !== 'error')}
            <div>
              <div class="mb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                What changed
              </div>
              {#if parsedNotes.redactions.length > 0}
                <ul class="m-0 flex flex-wrap gap-1.5 p-0">
                  {#each parsedNotes.redactions as label (label)}
                    <li
                      class="list-none rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-2 py-0.5 text-[0.6875rem] text-foreground"
                    >
                      {label}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if parsedNotes.plainText && e.status !== 'error'}
                <div class="mt-1 whitespace-pre-wrap text-[0.8125rem] text-muted">{parsedNotes.plainText}</div>
              {/if}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
  {#if overflow && showViewAll && onViewAll}
    <button
      type="button"
      class="mt-2 border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent underline-offset-2 hover:underline"
      onclick={() => onViewAll()}
    >
      View all activity ({entries.length}) →
    </button>
  {/if}
{/if}
