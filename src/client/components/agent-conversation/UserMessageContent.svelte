<script lang="ts">
  import { AtSign } from '@lucide/svelte'
  import { parseUserMessageSegments } from '@client/lib/userMessageMentions.js'
  import WikiFileName from '@components/WikiFileName.svelte'

  let { content }: { content: string } = $props()

  const segments = $derived(parseUserMessageSegments(content))
</script>

<div class="msg-content user-content whitespace-pre-wrap text-sm leading-[1.5] text-foreground max-md:text-base">
  {#each segments as seg, i (i)}
    {#if seg.kind === 'text'}{seg.text}{:else if seg.kind === 'wiki'}<span
        class="user-mention user-mention--wiki inline-flex max-w-full items-baseline align-baseline rounded-sm bg-accent-dim px-1 py-0 text-[0.9em] text-accent"
        title={seg.raw}
      ><WikiFileName path={seg.path} /></span>{:else}<span
        class="user-mention user-mention--person inline-flex items-baseline gap-0.5 align-baseline rounded-sm bg-[color-mix(in_srgb,var(--accent,#2563eb)_14%,transparent)] px-1.5 py-0 text-[0.9em] font-medium text-accent"
        title={`@${seg.handle}`}
      ><span class="user-mention-icon shrink-0 self-center" aria-hidden="true"
        ><AtSign size={11} strokeWidth={2.25} /></span><span class="user-mention-handle">{seg.handle}</span></span>{/if}
  {/each}
</div>
