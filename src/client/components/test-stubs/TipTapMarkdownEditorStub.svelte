<script lang="ts">
  /**
   * Lightweight stand-in for TipTap in jsdom (real editor pulls ProseMirror + DOM).
   */
  type Props = {
    initialMarkdown?: string
    markdownSyncEpoch?: number
    disabled?: boolean
    autoPersist?: boolean
    onPersist?: (_markdown: string) => Promise<void>
    onMarkdownUpdate?: (_markdown: string) => void
  }
  let {
    initialMarkdown = '',
    markdownSyncEpoch = 0,
    disabled = false,
    onPersist,
    onMarkdownUpdate,
  }: Props = $props()

  let md = $state('')

  /** Pre-DOM sync so tests and parents see markdown on first paint (`$effect` runs too late). */
  $effect.pre(() => {
    void markdownSyncEpoch
    md = initialMarkdown
  })

  export async function flushSave(): Promise<void> {
    await onPersist?.(md)
  }

  export function cancelDebouncedSave(): void {}

  export function serializeMarkdown(): string {
    return md
  }
</script>

<div data-testid="tiptap-editor-stub">
  <textarea
    data-testid="review-reply-textarea"
    class="w-full min-h-[6rem] resize-none bg-transparent font-sans text-sm"
    bind:value={md}
    {disabled}
    aria-label="Reply"
    oninput={(e) => onMarkdownUpdate?.((e.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>
</div>
