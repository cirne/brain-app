<script lang="ts">
  /** Preview for `read` / `read_doc` on a filesystem path — not wiki markdown. */
  let {
    path,
    excerpt,
    onOpen,
  }: {
    path: string
    excerpt: string
    onOpen: () => void
  } = $props()
</script>

<div class="relative my-2 rounded-lg border border-border bg-surface-3 px-3 py-2.5">
  <button
    type="button"
    class="absolute inset-0 z-0 m-0 cursor-pointer rounded-[inherit] border-none bg-transparent p-0"
    aria-label="Open file: {path}"
    onclick={onOpen}
  ></button>
  <div class="relative z-[1] mb-1 text-[0.7rem] font-normal uppercase tracking-wide text-[var(--muted,#888)]">
    File
  </div>
  <div
    class="relative z-[1] mb-2 break-all text-[0.8rem] text-foreground [word-break:break-all]"
  >
    {path}
  </div>
  <pre
    class="relative z-[1] m-0 max-h-32 overflow-hidden font-mono text-[0.8rem] leading-snug [word-break:break-word] whitespace-pre-wrap text-[var(--muted,#aaa)]"
  >{excerpt}</pre>
</div>
