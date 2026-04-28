<script lang="ts">
  import { onMount } from 'svelte'
  import { MessageSquare, ChevronDown, ChevronRight, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-svelte'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { FDA_GATE_OPEN_EVENT } from '@client/lib/onboarding/fdaGateKeys.js'

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

  function formatRelativeDate(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 60) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHour < 24) return `${diffHour}h ago`
    if (diffDay === 1) return 'yesterday'
    if (diffDay < 7) return `${diffDay}d ago`
    return d.toLocaleDateString()
  }

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
</script>

<div class="hub-apple-messages" data-testid="hub-apple-messages-panel">
  <div class="hub-apple-messages-inner">
    <header class="ham-hero">
      <div class="ham-hero-icon" aria-hidden="true">
        <MessageSquare size={22} strokeWidth={2} />
      </div>
      <div class="ham-hero-text">
        <h2 class="ham-title">Apple Messages on this Mac</h2>
        <p class="ham-lead">
          Search your texts in Braintunnel by copying a private snapshot from this Mac into your workspace. Data is used
          for your search index; you can disconnect anytime.
        </p>
      </div>
    </header>

    <section class="ham-block" aria-labelledby="ham-what-syncs">
      <h3 id="ham-what-syncs" class="ham-h">What syncs</h3>
      <p class="ham-p">
        Relevant iMessage history from <strong>this Mac</strong> is read locally and indexed so you can search and open
        threads in Braintunnel—similar to mail and folders in Search index.
      </p>
    </section>

    <section class="ham-block" aria-labelledby="ham-perms">
      <h3 id="ham-perms" class="ham-h">Permissions</h3>
      <p class="ham-p">
        macOS may ask for <strong>Full Disk Access</strong> so Braintunnel can read the Messages database on this machine.
        If you use contact names in threads, the app may ask for <strong>Contacts</strong> to show familiar names—resolved
        on your Mac before anything is stored.
      </p>
      {#if fdaGranted === false}
        <div class="ham-callout ham-callout--warn" role="status">
          <span class="ham-callout-icon" aria-hidden="true"><AlertTriangle size={18} /></span>
          <div class="ham-callout-body">
            <p class="ham-callout-p">
              Full Disk Access is off or not detected. Turn it on in System Settings, then return here.
            </p>
            <button type="button" class="hub-dialog-btn hub-dialog-btn-secondary ham-callout-btn" onclick={openFdaHelp}>
              Open Full Disk Access help
            </button>
          </div>
        </div>
      {:else if fdaGranted === true}
        <div class="ham-callout ham-callout--ok" role="status">
          <span class="ham-callout-icon ham-callout-icon--ok" aria-hidden="true"><CheckCircle2 size={18} /></span>
          <p class="ham-callout-p ham-callout-p--inline">Full Disk Access looks enabled for this app.</p>
        </div>
      {/if}
    </section>

    <details class="ham-disclosure" bind:open={detailsOpen}>
      <summary class="ham-disclosure-summary">
        <span class="ham-disclosure-chevron" aria-hidden="true">
          {#if detailsOpen}
            <ChevronDown size={16} strokeWidth={2} />
          {:else}
            <ChevronRight size={16} strokeWidth={2} />
          {/if}
        </span>
        Technical details
      </summary>
      <div class="ham-disclosure-body">
        <p class="ham-p ham-p--tight">
          Connections are revocable links between this workspace and a Braintunnel helper on your Mac. We do not show raw
          secrets after you leave this panel—use <strong>Turn on Messages sync</strong> again if you need a new link.
        </p>
      </div>
    </details>

    {#if turnOnError}
      <p class="ham-err" role="alert">{turnOnError}</p>
    {/if}

    {#if setupCode}
      <div class="ham-setup">
        <p class="ham-setup-title">Next step on this Mac</p>
        <p class="ham-p ham-p--muted">
          Paste this one-time code into the Braintunnel Mac helper when it asks. It is only shown here once—copy it now
          if you still need it.
        </p>
        <textarea class="ham-code" readonly rows={4} bind:value={setupCode}></textarea>
        <div class="ham-setup-actions">
          <button type="button" class="hub-dialog-btn hub-dialog-btn-primary" onclick={() => void copyText(setupCode ?? '')}>
            Copy code
          </button>
          <button type="button" class="hub-dialog-btn hub-dialog-btn-secondary" onclick={() => (setupCode = null)}>
            Hide code
          </button>
        </div>
      </div>
    {/if}

    <div class="ham-actions">
      <button
        type="button"
        class="hub-dialog-btn hub-dialog-btn-primary ham-btn-block"
        disabled={busy}
        onclick={() => void turnOn()}
      >
        {action?.kind === 'adding' ? 'Turning on…' : 'Turn on Messages sync'}
      </button>

      <details class="ham-disclosure ham-disclosure--nested" bind:open={advancedOpen}>
        <summary class="ham-disclosure-summary ham-disclosure-summary--subtle">
          <span class="ham-disclosure-chevron" aria-hidden="true">
            {#if advancedOpen}
              <ChevronDown size={16} strokeWidth={2} />
            {:else}
              <ChevronRight size={16} strokeWidth={2} />
            {/if}
          </span>
          Optional: name this Mac
        </summary>
        <div class="ham-disclosure-body">
          <label class="ham-label" for="ham-optional-name">Name (optional)</label>
          <input
            id="ham-optional-name"
            class="ham-input"
            type="text"
            maxlength={120}
            autocomplete="off"
            bind:value={optionalNameDraft}
            placeholder="e.g. Work MacBook"
          />
        </div>
      </details>
    </div>

    <section class="ham-block ham-block--ruled" aria-labelledby="ham-connections">
      <h3 id="ham-connections" class="ham-h">Active connections</h3>
      {#if loading}
        <p class="ham-muted" role="status">Loading…</p>
      {:else if loadError}
        <p class="ham-err" title={loadError}>{loadError}</p>
      {:else if devices.length === 0}
        <p class="ham-muted">None yet. Turn on sync above to link this Mac.</p>
      {:else}
        <ul class="ham-device-list">
          {#each devices as device (device.id)}
            <li class="ham-device">
              <div class="ham-device-main">
                <span class="ham-device-icon" aria-hidden="true"><Smartphone size={18} /></span>
                <div class="ham-device-text">
                  <p class="ham-device-name">{device.label}</p>
                  <p class="ham-device-meta">{activityLine(device.lastUsedAt, device.createdAt)}</p>
                  <p class="ham-device-meta">{scopesPlain(device.scopes)}</p>
                </div>
              </div>
              <button
                type="button"
                class="hub-dialog-btn hub-dialog-btn-secondary ham-device-action"
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

    <section class="ham-block ham-block--ruled ham-block--danger-zone">
      <h3 id="ham-remove" class="ham-h">Remove from search index</h3>
      <p class="ham-p ham-p--muted">
        Clears Messages content Braintunnel has already copied into this workspace. Your Apple Messages app is unchanged.
      </p>
      <button
        type="button"
        class="hub-dialog-btn hub-dialog-btn-danger ham-btn-block"
        disabled={busy}
        onclick={() => void wipeSyncedMessages()}
      >
        {action?.kind === 'wiping' ? 'Removing…' : 'Remove synced Messages from index'}
      </button>
    </section>

    <footer class="ham-footer">
      <button type="button" class="hub-dialog-btn hub-dialog-btn-secondary ham-btn-block" onclick={onClosePanel}>
        Close panel
      </button>
    </footer>
  </div>
</div>

<style>
  /* Layout aligned with HubWikiAboutPanel + HubSourceInspectPanel (scoped tokens, not Tailwind). */
  .hub-apple-messages {
    padding: 1rem 1.25rem 1.25rem;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .hub-apple-messages-inner {
    max-width: 36rem;
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
  }

  .ham-hero {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding-bottom: 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }

  .ham-hero-icon {
    flex-shrink: 0;
    margin-top: 0.15rem;
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ham-hero-text {
    min-width: 0;
  }

  .ham-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
    color: var(--text);
  }

  .ham-lead {
    margin: 0.5rem 0 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text-2);
  }

  .ham-block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ham-block--ruled {
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .ham-block--danger-zone {
    gap: 0.65rem;
  }

  .ham-h {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }

  .ham-p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text);
  }

  .ham-p--tight {
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .ham-p--muted {
    color: var(--text-2);
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .ham-muted {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
  }

  .ham-err {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--danger);
  }

  .ham-callout {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.65rem 0.75rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  }

  .ham-callout--warn {
    background: color-mix(in srgb, var(--danger) 8%, var(--bg-2));
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  }

  .ham-callout--ok {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-2));
    border-color: color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .ham-callout-icon {
    flex-shrink: 0;
    margin-top: 0.05rem;
    color: var(--danger);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ham-callout-icon--ok {
    color: var(--accent);
  }

  .ham-callout-body {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ham-callout-p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text);
  }

  .ham-callout-p--inline {
    padding-top: 0.05rem;
  }

  .ham-callout-btn {
    align-self: flex-start;
  }

  .ham-disclosure {
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: 8px;
    background: var(--bg-2);
    overflow: hidden;
  }

  .ham-disclosure--nested {
    background: var(--bg);
  }

  .ham-disclosure-summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.65rem 0.85rem;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
    user-select: none;
  }

  .ham-disclosure-summary::-webkit-details-marker {
    display: none;
  }

  .ham-disclosure-summary:hover {
    background: color-mix(in srgb, var(--bg-3) 50%, transparent);
  }

  .ham-disclosure-summary--subtle {
    font-weight: 600;
    color: var(--text-2);
    font-size: 0.8125rem;
  }

  .ham-disclosure[open] > .ham-disclosure-summary {
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .ham-disclosure-chevron {
    display: flex;
    color: var(--text-2);
  }

  .ham-disclosure-body {
    padding: 0.65rem 0.85rem 0.75rem;
  }

  .ham-setup {
    padding: 0.85rem 0.9rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-2));
  }

  .ham-setup-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
  }

  .ham-code {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.5rem;
    padding: 0.5rem 0.6rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.75rem;
    line-height: 1.4;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    resize: vertical;
    min-height: 4rem;
  }

  .ham-setup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.65rem;
  }

  .ham-actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .ham-btn-block {
    width: 100%;
    justify-content: center;
    text-align: center;
  }

  .ham-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: 0.35rem;
  }

  .ham-input {
    width: 100%;
    box-sizing: border-box;
    font-size: 0.875rem;
    padding: 0.4rem 0.55rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: var(--bg);
    color: var(--text);
  }

  .ham-device-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ham-device {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.75rem 0.85rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: var(--bg-2);
  }

  @media (min-width: 520px) {
    .ham-device {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .ham-device-main {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    min-width: 0;
  }

  .ham-device-icon {
    flex-shrink: 0;
    margin-top: 0.1rem;
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ham-device-text {
    min-width: 0;
  }

  .ham-device-name {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .ham-device-meta {
    margin: 0.2rem 0 0;
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--text-2);
  }

  .ham-device-action {
    flex-shrink: 0;
    align-self: flex-start;
  }

  @media (min-width: 520px) {
    .ham-device-action {
      align-self: center;
    }
  }

  .ham-footer {
    padding-top: 0.25rem;
  }

  /* Match HubSourceInspectPanel button recipe (scoped duplicate — same tokens). */
  .hub-dialog-btn {
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.45rem 0.9rem;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
  }

  .hub-dialog-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hub-dialog-btn-secondary {
    background: transparent;
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 80%, transparent);
  }

  .hub-dialog-btn-secondary:hover:not(:disabled) {
    background: var(--bg-2);
  }

  .hub-dialog-btn-danger {
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .hub-dialog-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 24%, var(--bg));
  }

  .hub-dialog-btn-primary {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .hub-dialog-btn-primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }
</style>
