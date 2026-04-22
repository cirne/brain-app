<script lang="ts">
  import { User } from 'lucide-svelte'

  const PREVIEW_ROWS = 4

  let {
    queryLine,
    people,
  }: {
    queryLine: string
    people: { name: string; email?: string }[]
  } = $props()

  const rows = $derived(people.slice(0, PREVIEW_ROWS))
  const more = $derived(Math.max(0, people.length - PREVIEW_ROWS))
</script>

<div class="find-person-preview">
  <div class="find-person-query" title={queryLine}>{queryLine}</div>
  {#if rows.length === 0}
    <p class="find-person-empty">No contacts in result.</p>
  {:else}
    <ul class="find-person-list" role="list">
      {#each rows as p, i (`${p.name}-${p.email ?? i}`)}
        <li class="find-person-row">
          <span class="find-person-icon" aria-hidden="true">
            <User size={11} />
          </span>
          <span class="find-person-line" title={[p.name, p.email].filter(Boolean).join(' · ')}>
            <span class="find-person-name">{p.name}</span>
            {#if p.email}
              <span class="find-person-sep" aria-hidden="true">·</span>
              <span class="find-person-email">{p.email}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if more > 0}
      <p class="find-person-more">+{more} more</p>
    {/if}
  {/if}
</div>

<style>
  .find-person-preview {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
  }
  .find-person-query {
    font-size: 11px;
    line-height: 1.25;
    color: var(--text-2);
    margin-bottom: 4px;
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .find-person-empty {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .find-person-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .find-person-row {
    display: flex;
    gap: 5px;
    align-items: center;
    min-width: 0;
  }
  .find-person-icon {
    flex-shrink: 0;
    color: var(--text-2);
    display: flex;
    align-items: center;
  }
  .find-person-line {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    flex: 1;
    font-size: 11px;
    line-height: 1.25;
  }
  .find-person-name {
    flex: 0 1 auto;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find-person-sep {
    flex-shrink: 0;
    color: var(--text-2);
    opacity: 0.7;
    padding: 0 0.05rem;
  }
  .find-person-email {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find-person-more {
    margin: 4px 0 0;
    font-size: 10px;
    color: var(--text-2);
  }
</style>
