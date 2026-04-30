<script lang="ts">
  /** Stub for SlideOver tests — full editor tested in EmailDraftEditor.test.ts */
  let { draftId }: { draftId?: string } = $props()
</script>

<div data-testid="email-draft-editor-stub">
  Email draft stub{draftId ? `: ${draftId}` : ''}
</div>
