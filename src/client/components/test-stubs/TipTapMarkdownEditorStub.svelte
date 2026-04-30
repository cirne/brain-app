<script lang="ts">
  /**
   * Lightweight stand-in for TipTap in jsdom (real editor pulls ProseMirror + DOM).
   */
  type Props = {
    initialMarkdown?: string
    disabled?: boolean
    autoPersist?: boolean
    onPersist?: (_markdown: string) => Promise<void>
  }
  let { initialMarkdown = '', onPersist }: Props = $props()

  let md = $state('')
  $effect(() => {
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

<div data-testid="tiptap-editor-stub">{md}</div>
