<script lang="ts">
  /**
   * TipTap editor for onboarding profile draft (YAML front matter preserved).
   * Persists to disk only when the parent calls {@link flushSave} (Looks Good), not on each keystroke.
   */
  import TipTapMarkdownEditor from '@tw-components/TipTapMarkdownEditor.svelte'

  interface Props {
    initialMarkdown?: string
    disabled?: boolean
  }
  let { initialMarkdown = '', disabled = false }: Props = $props()

  let inner = $state<{ flushSave: () => Promise<void> } | null>(null)

  async function onPersist(markdown: string) {
    const res = await fetch('/api/onboarding/profile-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    })
    if (!res.ok) return
  }

  /** Persist current editor markdown to disk (Looks Good). */
  export async function flushSave() {
    await inner?.flushSave()
  }
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <TipTapMarkdownEditor
    bind:this={inner}
    {initialMarkdown}
    {disabled}
    autoPersist={false}
    {onPersist}
  />
</div>
