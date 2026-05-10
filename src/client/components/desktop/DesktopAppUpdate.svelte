<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from '@client/lib/i18n/index.js'
  import type { Update } from '@tauri-apps/plugin-updater'

  let pending = $state<Update | null>(null)
  let busy = $state(false)
  let err = $state<string | null>(null)

  onMount(() => {
    if (import.meta.env.DEV) return
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const u = await check()
        if (u) pending = u
      } catch {
        // Not a Tauri shell or updater not configured (e.g. empty `endpoints`).
      }
    })()
  })

  async function installAndRelaunch() {
    if (!pending) return
    const u = pending
    busy = true
    err = null
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await u.downloadAndInstall()
      await u.close()
      await relaunch()
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

{#if pending}
  <div
    class="fixed bottom-3 right-3 z-[20000] flex max-w-[min(100vw-1.5rem,420px)] flex-wrap items-center gap-2.5 bg-[var(--panel,#1e1e1e)] p-2.5 px-3.5 text-sm text-[var(--text,#eee)] shadow-[0_4px_24px_rgba(0,0,0,0.4)] [font:inherit]"
    role="status"
    aria-live="polite"
  >
    <span class="min-w-40 flex-1 [flex:1_1_10rem]">
      {$t('common.desktopAppUpdate.available', { version: pending.version })}{err ? ` — ${err}` : ''}
    </span>
    <button
      type="button"
      class="shrink-0 cursor-pointer border border-border bg-surface-2 px-3 py-1.5 text-xs text-inherit [font:inherit] [background:var(--button-bg,#2a2a2a)] [border-color:var(--border,#444)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={busy}
      onclick={installAndRelaunch}
    >
      {busy ? $t('common.desktopAppUpdate.actions.installing') : $t('common.desktopAppUpdate.actions.restartToUpdate')}
    </button>
  </div>
{/if}
