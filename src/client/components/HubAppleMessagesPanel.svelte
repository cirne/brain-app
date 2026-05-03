<script lang="ts">
  import { onMount } from 'svelte'
  import { MessageSquare, ChevronDown, ChevronRight, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { FDA_GATE_OPEN_EVENT } from '@client/lib/onboarding/fdaGateKeys.js'
  import { formatRelativeDate } from '@client/lib/hub/hubRipmailSource.js'

  type HubConnectedDevice = {
    id: string
    label: string
    createdAt: string
    lastUsedAt: string | null
    scopes: string[]
  }

  type PanelAction =
    | { kind: 'adding' }
    | { kind: 'revoking'; deviceId: string }
    | { kind: 'wiping' }

  type Props = {
    onClosePanel: () => void
  }

  let { onClosePanel }: Props = $props()

  let devices = $state<HubConnectedDevice[]>([])
  let loadError = $state<string | null>(null)
  let loading = $state(true)
  let action = $state<PanelAction | null>(null)
  let turnOnError = $state<string | null>(null)
  let setupCode = $state<string | null>(null)
  let advancedOpen = $state(false)
  let optionalNameDraft = $state('')
  let detailsOpen = $state(false)
  let fdaGranted = $state<boolean | null>(null)

  const busy = $derived(action !== null)

  function activityLine(lastUsedAt: string | null, createdAt: string): string {
    if (lastUsedAt) return `Last sync ${formatRelativeDate(lastUsedAt)}`
    return `Linked ${formatRelativeDate(createdAt)} · waiting for first sync from this Mac`
  }

  function scopesPlain(scopes: string[]): string {
    if (!Array.isArray(scopes) || scopes.length === 0) return 'Messages from this Mac'
    if (scopes.includes('ingest:imessage')) return 'Messages from this Mac'
    return scopes.join(', ')
  }

  async function readApiError(response: Response, fallback: string): Promise<string> {
    const j = (await response.json().catch(() => null)) as { error?: string } | null
    const detail = typeof j?.error === 'string' ? j.error.trim() : ''
    if (!detail) return fallback
    return `${fallback} (${detail})`
  }

  async function fetchDevices(): Promise<void> {
    loadError = null
    try {
      const res = await fetch('/api/devices')
      const j = (await res.json().catch(() => null)) as { ok?: boolean; devices?: unknown; error?: string } | null
      if (!res.ok) {
        loadError =
          typeof j?.error === 'string' && j.error.trim()
            ? j.error.trim()
            : `Could not load connections (${res.status})`
        devices = []
        return
      }
      devices = Array.isArray(j?.devices) ? (j.devices as HubConnectedDevice[]) : []
    } catch {
      loadError = 'Could not load connections'
      devices = []
    } finally {
      loading = false
    }
  }

  function notifyHubDevicesChanged(): void {
    emit({ type: 'hub:devices-changed' })
  }

  async function probeFda(): Promise<void> {
    try {
      const res = await fetch('/api/onboarding/fda')
      if (!res.ok) {
        fdaGranted = null
        return
      }
      const j = (await res.json()) as { granted?: boolean }
      fdaGranted = j.granted === true ? true : j.granted === false ? false : null
    } catch {
      fdaGranted = null
    }
  }

  function openFdaHelp(): void {
    window.dispatchEvent(new CustomEvent(FDA_GATE_OPEN_EVENT))
  }

  async function copyText(text: string): Promise<void> {
    if (!text) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textArea)
        if (!ok) throw new Error('copy failed')
      }
    } catch {
      /* ignore */
    }
  }

  async function turnOn(): Promise<void> {
    if (busy) return
    turnOnError = null
    setupCode = null
    const name = optionalNameDraft.trim()
    if (name.length > 120) {
      turnOnError = 'Use a shorter name (120 characters max), or leave it blank.'
      return
    }
    action = { kind: 'adding' }
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: name ? JSON.stringify({ label: name }) : '{}',
      })
      if (!res.ok) {
        turnOnError = await readApiError(res, 'Could not turn on Messages sync')
        return
      }
      const j = (await res.json()) as { ok?: boolean; token?: string }
      if (j.ok !== true || typeof j.token !== 'string' || !j.token) {
        turnOnError = 'Could not turn on Messages sync'
        return
      }
      setupCode = j.token
      optionalNameDraft = ''
      await fetchDevices()
      notifyHubDevicesChanged()
      void pollForFirstUse()
    } catch {
      turnOnError = 'Could not turn on Messages sync'
    } finally {
      action = null
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined
  function pollForFirstUse(): void {
    if (pollTimer) clearInterval(pollTimer)
    let ticks = 0
    pollTimer = setInterval(() => {
      ticks += 1
      if (ticks > 20) {
        clearInterval(pollTimer)
        pollTimer = undefined
        return
      }
      void fetch('/api/devices')
        .then((r) => r.json())
        .then((j: { devices?: HubConnectedDevice[] }) => {
          const rows = Array.isArray(j?.devices) ? j.devices : []
          if (rows.some((d) => d.lastUsedAt)) {
            devices = rows
            notifyHubDevicesChanged()
            clearInterval(pollTimer)
            pollTimer = undefined
          }
        })
        .catch(() => {})
    }, 3000)
  }

  async function disconnectDevice(device: HubConnectedDevice): Promise<void> {
    if (busy) return
    const ok = window.confirm(
      `Stop syncing from “${device.label}”? You can turn this on again later; Messages already copied stay in your workspace until you remove them separately.`,
    )
    if (!ok) return
    action = { kind: 'revoking', deviceId: device.id }
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        alert(await readApiError(res, 'Could not disconnect'))
        return
      }
      await fetchDevices()
      notifyHubDevicesChanged()
    } catch {
      alert('Could not disconnect')
    } finally {
      action = null
    }
  }

  async function wipeSyncedMessages(): Promise<void> {
    if (busy) return
    const ok = window.confirm(
      'Remove all synced Messages data from Braintunnel in this workspace? This does not delete texts in Apple Messages.',
    )
    if (!ok) return
    action = { kind: 'wiping' }
    try {
      const res = await fetch('/api/ingest/imessage/wipe', {
        method: 'POST',
      })
      if (!res.ok) {
        alert(await readApiError(res, 'Could not remove synced data'))
        return
      }
      const j = (await res.json()) as { ok?: boolean; deleted?: number }
      const deleted = typeof j.deleted === 'number' ? j.deleted : 0
      await fetchDevices()
      notifyHubDevicesChanged()
      alert(`Removed ${deleted} synced conversation${deleted === 1 ? '' : 's'} from the index.`)
    } catch {
      alert('Could not remove synced data')
    } finally {
      action = null
    }
  }

  onMount(() => {
    void fetchDevices()
    void probeFda()
    const unsub = subscribe((e) => {
      if (e.type === 'sync:completed') void fetchDevices()
    })
    return () => {
      unsub()
      if (pollTimer) clearInterval(pollTimer)
    }
  })

  /** Hub button recipes (mirrors HubBackgroundAgentsDetail / HubConnectorSourcePanel). */
  const hubBtn =
    'hub-dialog-btn inline-flex cursor-pointer items-center justify-center gap-[0.35rem] rounded-md border border-transparent px-[0.9rem] py-[0.45rem] text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60'
  const hubBtnPrimary =
    'hub-dialog-btn-primary border-[color-mix(in_srgb,var(--accent)_80%,black)] bg-accent text-white hover:not-disabled:[filter:brightness(1.06)]'
  const hubBtnSecondary =
    'hub-dialog-btn-secondary border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-transparent text-foreground hover:not-disabled:bg-surface-2'
  const hubBtnDanger =
    'hub-dialog-btn-danger border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_14%,var(--bg))] text-danger hover:not-disabled:bg-[color-mix(in_srgb,var(--danger)_24%,var(--bg))]'
  const hamBtnBlock = 'ham-btn-block w-full text-center'
</script>

<div class="hub-apple-messages min-h-0 flex-1 overflow-auto px-5 pb-5 pt-4" data-testid="hub-apple-messages-panel">
  <div class="hub-apple-messages-inner flex max-w-[36rem] flex-col gap-[1.15rem]">
    <header
      class="ham-hero flex items-start gap-3 border-b border-[color-mix(in_srgb,var(--border)_55%,transparent)] pb-4"
    >
      <div class="ham-hero-icon mt-[0.15rem] flex shrink-0 items-center justify-center text-accent" aria-hidden="true">
        <MessageSquare size={22} strokeWidth={2} />
      </div>
      <div class="ham-hero-text min-w-0">
        <h2 class="ham-title m-0 text-[1.125rem] font-bold tracking-tight leading-tight text-foreground">Apple Messages on this Mac</h2>
        <p class="ham-lead m-0 mt-2 text-[0.9375rem] leading-[1.55] text-muted">
          Search your texts in Braintunnel by copying a private snapshot from this Mac into your workspace. Data is used
          for your search index; you can disconnect anytime.
        </p>
      </div>
    </header>

    <section class="ham-block flex flex-col gap-2" aria-labelledby="ham-what-syncs">
      <h3 id="ham-what-syncs" class="ham-h m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted">What syncs</h3>
      <p class="ham-p m-0 text-[0.9375rem] leading-[1.55] text-foreground">
        Relevant iMessage history from <strong>this Mac</strong> is read locally and indexed so you can search and open
        threads in Braintunnel—similar to mail and folders in Search index.
      </p>
    </section>

    <section class="ham-block flex flex-col gap-2" aria-labelledby="ham-perms">
      <h3 id="ham-perms" class="ham-h m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted">Permissions</h3>
      <p class="ham-p m-0 text-[0.9375rem] leading-[1.55] text-foreground">
        macOS may ask for <strong>Full Disk Access</strong> so Braintunnel can read the Messages database on this machine.
        If you use contact names in threads, the app may ask for <strong>Contacts</strong> to show familiar names—resolved
        on your Mac before anything is stored.
      </p>
      {#if fdaGranted === false}
        <div
          class="ham-callout ham-callout--warn flex items-start gap-[0.6rem] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,var(--bg-2))] px-3 py-[0.65rem]"
          role="status"
        >
          <span class="ham-callout-icon mt-[0.05rem] flex shrink-0 items-center justify-center text-danger" aria-hidden="true">
            <AlertTriangle size={18} />
          </span>
          <div class="ham-callout-body flex min-w-0 flex-1 flex-col gap-2">
            <p class="ham-callout-p m-0 text-[0.8125rem] leading-tight text-foreground">
              Full Disk Access is off or not detected. Turn it on in System Settings, then return here.
            </p>
            <button type="button" class={cn(hubBtn, hubBtnSecondary, 'ham-callout-btn self-start')} onclick={openFdaHelp}>
              Open Full Disk Access help
            </button>
          </div>
        </div>
      {:else if fdaGranted === true}
        <div
          class="ham-callout ham-callout--ok flex items-start gap-[0.6rem] border border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg-2))] px-3 py-[0.65rem]"
          role="status"
        >
          <span class="ham-callout-icon ham-callout-icon--ok mt-[0.05rem] flex shrink-0 items-center justify-center text-accent" aria-hidden="true">
            <CheckCircle2 size={18} />
          </span>
          <p class="ham-callout-p ham-callout-p--inline m-0 pt-[0.05rem] text-[0.8125rem] leading-tight text-foreground">Full Disk Access looks enabled for this app.</p>
        </div>
      {/if}
    </section>

    <details
      class="ham-disclosure overflow-hidden border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface-2 [&[open]>summary]:border-b [&[open]>summary]:border-[color-mix(in_srgb,var(--border)_60%,transparent)]"
      bind:open={detailsOpen}
    >
      <summary
        class="ham-disclosure-summary flex cursor-pointer select-none items-center gap-[0.35rem] px-[0.85rem] py-[0.65rem] text-sm font-semibold text-foreground hover:bg-[color-mix(in_srgb,var(--bg-3)_50%,transparent)] [&::-webkit-details-marker]:hidden"
      >
        <span class="ham-disclosure-chevron flex text-muted" aria-hidden="true">
          {#if detailsOpen}
            <ChevronDown size={16} strokeWidth={2} />
          {:else}
            <ChevronRight size={16} strokeWidth={2} />
          {/if}
        </span>
        Technical details
      </summary>
      <div class="ham-disclosure-body px-[0.85rem] pb-3 pt-[0.65rem]">
        <p class="ham-p ham-p--tight m-0 text-[0.8125rem] leading-tight text-foreground">
          Connections are revocable links between this workspace and a Braintunnel helper on your Mac. We do not show raw
          secrets after you leave this panel—use <strong>Turn on Messages sync</strong> again if you need a new link.
        </p>
      </div>
    </details>

    {#if turnOnError}
      <p class="ham-err m-0 text-[0.8125rem] leading-tight text-danger" role="alert">{turnOnError}</p>
    {/if}

    {#if setupCode}
      <div class="ham-setup border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg-2))] px-[0.9rem] py-[0.85rem]">
        <p class="ham-setup-title m-0 text-sm font-semibold text-foreground">Next step on this Mac</p>
        <p class="ham-p ham-p--muted m-0 text-[0.8125rem] leading-tight text-muted">
          Paste this one-time code into the Braintunnel Mac helper when it asks. It is only shown here once—copy it now
          if you still need it.
        </p>
        <textarea
          class="ham-code mt-2 block min-h-[4rem] w-full resize-y border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface px-[0.6rem] py-2 text-xs leading-tight text-foreground [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]"
          readonly
          rows={4}
          bind:value={setupCode}
        ></textarea>
        <div class="ham-setup-actions mt-[0.65rem] flex flex-wrap gap-2">
          <button type="button" class={cn(hubBtn, hubBtnPrimary)} onclick={() => void copyText(setupCode ?? '')}>
            Copy code
          </button>
          <button type="button" class={cn(hubBtn, hubBtnSecondary)} onclick={() => (setupCode = null)}>
            Hide code
          </button>
        </div>
      </div>
    {/if}

    <div class="ham-actions flex flex-col gap-[0.6rem]">
      <button
        type="button"
        class={cn(hubBtn, hubBtnPrimary, hamBtnBlock)}
        disabled={busy}
        onclick={() => void turnOn()}
      >
        {action?.kind === 'adding' ? 'Turning on…' : 'Turn on Messages sync'}
      </button>

      <details
        class="ham-disclosure ham-disclosure--nested overflow-hidden border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface [&[open]>summary]:border-b [&[open]>summary]:border-[color-mix(in_srgb,var(--border)_60%,transparent)]"
        bind:open={advancedOpen}
      >
        <summary
          class="ham-disclosure-summary ham-disclosure-summary--subtle flex cursor-pointer select-none items-center gap-[0.35rem] px-[0.85rem] py-[0.65rem] text-[0.8125rem] font-semibold text-muted hover:bg-[color-mix(in_srgb,var(--bg-3)_50%,transparent)] [&::-webkit-details-marker]:hidden"
        >
          <span class="ham-disclosure-chevron flex text-muted" aria-hidden="true">
            {#if advancedOpen}
              <ChevronDown size={16} strokeWidth={2} />
            {:else}
              <ChevronRight size={16} strokeWidth={2} />
            {/if}
          </span>
          Optional: name this Mac
        </summary>
        <div class="ham-disclosure-body px-[0.85rem] pb-3 pt-[0.65rem]">
          <label class="ham-label mb-[0.35rem] block text-xs font-semibold text-muted" for="ham-optional-name">Name (optional)</label>
          <input
            id="ham-optional-name"
            class="ham-input box-border w-full border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface px-[0.55rem] py-[0.4rem] text-sm text-foreground"
            type="text"
            maxlength={120}
            autocomplete="off"
            bind:value={optionalNameDraft}
            placeholder="e.g. Work MacBook"
          />
        </div>
      </details>
    </div>

    <section
      class="ham-block ham-block--ruled flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-4"
      aria-labelledby="ham-connections"
    >
      <h3 id="ham-connections" class="ham-h m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted">Active connections</h3>
      {#if loading}
        <p class="ham-muted m-0 text-[0.8125rem] leading-tight text-muted" role="status">Loading…</p>
      {:else if loadError}
        <p class="ham-err m-0 text-[0.8125rem] leading-tight text-danger" title={loadError}>{loadError}</p>
      {:else if devices.length === 0}
        <p class="ham-muted m-0 text-[0.8125rem] leading-tight text-muted">None yet. Turn on sync above to link this Mac.</p>
      {:else}
        <ul class="ham-device-list m-0 flex list-none flex-col gap-2 p-0">
          {#each devices as device (device.id)}
            <li
              class="ham-device flex flex-col gap-[0.65rem] border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface-2 px-[0.85rem] py-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between"
            >
              <div class="ham-device-main flex min-w-0 items-start gap-[0.55rem]">
                <span class="ham-device-icon mt-[0.1rem] flex shrink-0 items-center justify-center text-muted" aria-hidden="true"><Smartphone size={18} /></span>
                <div class="ham-device-text min-w-0">
                  <p class="ham-device-name m-0 text-sm font-semibold leading-tight text-foreground">{device.label}</p>
                  <p class="ham-device-meta m-0 mt-[0.2rem] text-xs leading-tight text-muted">{activityLine(device.lastUsedAt, device.createdAt)}</p>
                  <p class="ham-device-meta m-0 mt-[0.2rem] text-xs leading-tight text-muted">{scopesPlain(device.scopes)}</p>
                </div>
              </div>
              <button
                type="button"
                class={cn(hubBtn, hubBtnSecondary, 'ham-device-action shrink-0 self-start min-[520px]:self-center')}
                disabled={busy}
                onclick={() => void disconnectDevice(device)}
              >
                {action?.kind === 'revoking' && action.deviceId === device.id ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section
      class="ham-block ham-block--ruled ham-block--danger-zone flex flex-col gap-[0.65rem] border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-4"
    >
      <h3 id="ham-remove" class="ham-h m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted">Remove from search index</h3>
      <p class="ham-p ham-p--muted m-0 text-[0.8125rem] leading-tight text-muted">
        Clears Messages content Braintunnel has already copied into this workspace. Your Apple Messages app is unchanged.
      </p>
      <button
        type="button"
        class={cn(hubBtn, hubBtnDanger, hamBtnBlock)}
        disabled={busy}
        onclick={() => void wipeSyncedMessages()}
      >
        {action?.kind === 'wiping' ? 'Removing…' : 'Remove synced Messages from index'}
      </button>
    </section>

    <footer class="ham-footer pt-1">
      <button type="button" class={cn(hubBtn, hubBtnSecondary, hamBtnBlock)} onclick={onClosePanel}>
        Close panel
      </button>
    </footer>
  </div>
</div>
