/**
 * Shared Tailwind class strings for the left-rail chat history UI
 * (`ChatHistory.svelte` + `HistoryRailNavSection.svelte`).
 */
export const chatHistoryRailPrimaryBtn =
  'mb-2 box-border flex w-full max-w-full cursor-pointer items-center justify-start gap-1.5 rounded-md border border-border bg-transparent px-2.5 py-[7px] text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-3 hover:border-muted max-md:text-[13px]'

export const chatHistoryRailViewAllBtn =
  'mt-1.5 box-border flex w-full max-w-full cursor-pointer rounded-md border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[11px] font-medium text-accent transition-colors hover:bg-surface-3 hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 max-md:text-xs'

/** Row stack: no vertical gap between history items (see scoped `.ch-row-list` in ChatHistory). */
export const chatHistoryRowListClass =
  'ch-row-list flex min-h-0 w-full max-w-full min-w-0 flex-col gap-0'

export const chatHistoryRailEmptyMutedClass =
  'px-2 py-2 pb-2 text-xs italic text-muted max-md:text-sm'
