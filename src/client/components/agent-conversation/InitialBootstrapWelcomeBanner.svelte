<script lang="ts">
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'

  let { class: className = '' }: { class?: string } = $props()
</script>

<section
  data-testid="initial-bootstrap-welcome"
  class={cn(
    'bootstrap-welcome-hero mb-5 flex flex-col justify-center rounded-2xl border border-white/[0.08] bg-[#10100e] px-5 py-8 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)] md:min-h-[32vh] md:px-10 md:py-12 lg:min-h-[34vh]',
    className,
  )}
  aria-labelledby="bootstrap-welcome-heading"
>
  <div class="mx-auto w-full max-w-2xl text-center">
    <h2
      id="bootstrap-welcome-heading"
      class="text-balance text-2xl leading-[1.15] font-bold tracking-[-0.02em] text-[#f7f5f0] md:text-3xl lg:text-[2rem] lg:leading-tight"
    >
      {$t('chat.bootstrapWelcome.headline')}
    </h2>
    <p
      class="mt-5 text-balance text-base font-semibold leading-relaxed text-[#d9d4c8] md:mt-7 md:text-lg md:leading-relaxed"
    >
      {$t('chat.bootstrapWelcome.body1')}
    </p>
    <p
      class="mt-4 text-balance text-base font-semibold leading-relaxed text-[#c9c2b4] md:mt-5 md:text-lg md:leading-relaxed"
    >
      {$t('chat.bootstrapWelcome.body2')}
    </p>
  </div>
</section>
