<script lang="ts">
  /**
   * TipTap editor for onboarding profile draft (markdown on disk, YAML front matter preserved).
   */
  import TipTapMarkdownEditor from '../TipTapMarkdownEditor.svelte'

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

  /** Call before Accept to avoid losing debounced edits. */
  export async function flushSave() {
    await inner?.flushSave()
  }
</script>

<div class="profile-draft-editor">
  <TipTapMarkdownEditor
    bind:this={inner}
    initialMarkdown={initialMarkdown}
    disabled={disabled}
    onPersist={onPersist}
  />
</div>

<style>
  .profile-draft-editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
