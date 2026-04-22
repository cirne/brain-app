<script lang="ts">
  import { Mail } from 'lucide-svelte'

  let {
    subject,
    from,
    snippet,
    onOpen,
  }: {
    subject: string
    from: string
    snippet: string
    onOpen: () => void
  } = $props()
</script>

<button
  type="button"
  class="email-tool-preview"
  onclick={onOpen}
  aria-label="Open email thread: {subject}"
>
  <span class="email-tool-lead" aria-hidden="true">
    <Mail size={14} />
  </span>
  <span class="email-tool-body">
    <span class="email-tool-subject">{subject}</span>
    {#if from}
      <span class="email-tool-from">{from}</span>
    {/if}
    {#if snippet}
      <span class="email-tool-snippet">{snippet}</span>
    {/if}
  </span>
</button>

<style>
  .email-tool-preview {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    width: 100%;
    max-width: 100%;
    margin: 4px 0 0;
    padding: 4px 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }

  .email-tool-preview:hover .email-tool-subject {
    color: var(--accent);
  }

  .email-tool-lead {
    flex-shrink: 0;
    color: var(--text-2);
    margin-top: 1px;
  }

  .email-tool-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .email-tool-subject {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .email-tool-from {
    font-size: 11px;
    color: var(--text-2);
  }

  .email-tool-snippet {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
