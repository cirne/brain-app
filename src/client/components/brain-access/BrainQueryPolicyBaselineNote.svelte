<script lang="ts">
  import { POLICY_ALWAYS_OMIT } from '@shared/brainQueryAnswerBaseline.js'
</script>

<div
  class="rounded-md border border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] px-3 py-2.5 text-muted"
  aria-label="Categories Braintunnel always blocks on brain queries"
>
  <p class="m-0 text-[0.75rem] leading-snug">
    Braintunnel always prevents the categories below from being shared in brain queries, in addition to your policy. You do not need to repeat them in your own text.
  </p>
  <details class="mt-2 group">
    <summary
      class="cursor-pointer select-none text-[0.6875rem] font-medium tracking-wide text-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
    >
      <span class="underline-offset-2 group-open:no-underline hover:underline">Show baseline list</span>
    </summary>
    <pre
      class="mt-2 mb-0 max-h-[min(40vh,16rem)] overflow-auto whitespace-pre-wrap break-words rounded border border-[color-mix(in_srgb,var(--border)_35%,transparent)] bg-surface p-2 font-mono text-[0.625rem] leading-relaxed text-muted"
    >{POLICY_ALWAYS_OMIT}</pre>
  </details>
</div>
