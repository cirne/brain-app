<script lang="ts">
  import { POLICY_ALWAYS_OMIT } from '@shared/brainQueryAnswerBaseline.js'
  import { baselineListPreClass } from './brainQueryPolicyBaselineClasses.js'
  import { t } from '@client/lib/i18n/index.js'
</script>

<div
  class="rounded-md border border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] px-3 py-2.5 text-muted"
  aria-label={$t('access.brainQueryPolicyBaselineNote.ariaLabel')}
>
  <p class="m-0 text-[0.75rem] leading-snug">
    {$t('access.brainQueryPolicyBaselineNote.description')}
  </p>
  <details class="mt-2 group">
    <summary
      class="cursor-pointer select-none text-[0.6875rem] font-medium tracking-wide text-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
    >
      <span class="underline-offset-2 group-open:no-underline hover:underline">
        {$t('access.brainQueryPolicyBaselineNote.showBaselineList')}
      </span>
    </summary>
    <pre class="mt-2 mb-0 {baselineListPreClass}">{POLICY_ALWAYS_OMIT}</pre>
  </details>
</div>
