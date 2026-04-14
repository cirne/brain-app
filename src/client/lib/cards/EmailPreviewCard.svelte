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

<button type="button" class="email-card" onclick={onOpen} aria-label="Open email thread: {subject}">
  <div class="email-row">
    <Mail size={14} aria-hidden="true" />
    <span class="email-subject">{subject}</span>
  </div>
  {#if from}
    <div class="email-from">{from}</div>
  {/if}
  {#if snippet}
    <p class="email-snippet">{snippet}</p>
  {/if}
</button>

<style>
  .email-card {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .email-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .email-subject {
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .email-from {
    font-size: 12px;
    color: var(--text-2);
    margin-top: 4px;
  }
  .email-snippet {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
  }
</style>
