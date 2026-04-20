<script lang="ts">
  import { onMount } from 'svelte'
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
  <div class="desktop-update" role="status" aria-live="polite">
    <span class="desktop-update-text">
      Braintunnel {pending.version} is available{err ? ` — ${err}` : ''}
    </span>
    <button
      type="button"
      class="desktop-update-btn"
      disabled={busy}
      onclick={installAndRelaunch}
    >
      {busy ? 'Installing…' : 'Restart to update'}
    </button>
  </div>
{/if}

<style>
  .desktop-update {
    position: fixed;
    z-index: 20000;
    right: 12px;
    bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    max-width: min(100vw - 24px, 420px);
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--panel, #1e1e1e);
    color: var(--text, #eee);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    font-size: 0.875rem;
  }
  .desktop-update-text {
    flex: 1 1 160px;
  }
  .desktop-update-btn {
    flex: 0 0 auto;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border, #444);
    background: var(--button-bg, #2a2a2a);
    color: inherit;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .desktop-update-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .desktop-update-btn:not(:disabled):hover {
    filter: brightness(1.08);
  }
</style>
