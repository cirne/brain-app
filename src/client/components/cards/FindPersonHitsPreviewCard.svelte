<script lang="ts">
  import { User } from 'lucide-svelte'

  const PREVIEW_ROWS = 3

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

<div class="find-person-preview mt-1 min-w-0 max-w-full">
  <div
    class="find-person-query mb-1 font-mono text-[11px] leading-[1.25] text-muted [overflow-wrap:anywhere]"
    title={queryLine}
  >{queryLine}</div>
  {#if rows.length === 0}
    <p class="find-person-empty m-0 text-xs text-muted">No contacts in result.</p>
  {:else}
    <ul class="find-person-list m-0 flex list-none flex-col gap-[3px] p-0" role="list">
      {#each rows as p, i (`${p.name}-${p.email ?? i}`)}
        <li class="find-person-row flex min-w-0 items-center gap-[5px]">
          <span class="find-person-icon flex shrink-0 items-center text-muted" aria-hidden="true">
            <User size={11} />
          </span>
          <span
            class="find-person-line flex min-w-0 flex-1 items-center gap-[0.3rem] text-[11px] leading-[1.25]"
            title={[p.name, p.email].filter(Boolean).join(' · ')}
          >
            <span class="find-person-name min-w-0 flex-[0_1_auto] truncate font-semibold">{p.name}</span>
            {#if p.email}
              <span class="find-person-sep shrink-0 px-[0.05rem] text-muted opacity-70" aria-hidden="true">·</span>
              <span class="find-person-email min-w-0 flex-[1_1_auto] truncate text-muted">{p.email}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if more > 0}
      <p class="find-person-more mt-1 text-[10px] text-muted">+{more} more</p>
    {/if}
  {/if}
</div>
