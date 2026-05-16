<script lang="ts">
  import { WifiOff } from '@lucide/svelte'
  import { t } from '@client/lib/i18n/index.js'
  import { probeConnectionImmediately } from '@client/lib/connectionStatus.js'

  function retry() {
    probeConnectionImmediately()
  }
</script>

<!-- Full-screen overlay above main shell when server is unreachable -->
<div
  class="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] px-6 py-8 backdrop-blur-sm"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="connection-lost-title"
  aria-describedby="connection-lost-desc"
>
  <div class="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-8 text-center shadow-lg">
    <div class="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-muted" aria-hidden="true">
      <WifiOff size={22} strokeWidth={2} />
    </div>
    <h2 id="connection-lost-title" class="text-base font-semibold text-foreground">
      {$t('common.connectionLost.title')}
    </h2>
    <p id="connection-lost-desc" class="text-sm leading-relaxed text-muted">
      {$t('common.connectionLost.lead')}
    </p>
    <button
      type="button"
      class="mt-1 rounded-lg border border-[var(--border)] bg-surface-2 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-3"
      onclick={retry}
    >
      {$t('common.connectionLost.retry')}
    </button>
  </div>
</div>
