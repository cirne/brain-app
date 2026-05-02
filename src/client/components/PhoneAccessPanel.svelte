<script lang="ts">
  import { onMount } from 'svelte'
  import QRCode from 'qrcode'
  import { Smartphone, Wifi, Copy, Check, ExternalLink, ShieldCheck, Globe, Lock, RefreshCw } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'

  let networkInfo = $state<{
    ips: string[]
    port: number
    tunnelUrl: string | null
    localUrlScheme?: 'http' | 'https'
  } | null>(null)
  let qrCodeDataUrl = $state<string | null>(null)
  let copied = $state(false)
  let error = $state<string | null>(null)
  let remoteAccessEnabled = $state(false)
  let allowLanDirectAccess = $state(false)
  let isToggling = $state(false)
  let isTogglingLan = $state(false)
  let isResetting = $state(false)

  async function fetchNetworkInfo() {
    try {
      const res = await fetch('/api/onboarding/network-info')
      if (!res.ok) throw new Error('Failed to fetch network info')
      networkInfo = await res.json()

      await generateQrCode()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error'
    }
  }

  async function fetchPreferences() {
    try {
      const res = await fetch('/api/onboarding/preferences')
      if (res.ok) {
        const prefs = await res.json()
        remoteAccessEnabled = prefs.remoteAccessEnabled === true
        allowLanDirectAccess = prefs.allowLanDirectAccess === true
      }
    } catch {
      /* ignore */
    }
  }

  function localNetworkBaseUrl(n: NonNullable<typeof networkInfo>) {
    const sch = n.localUrlScheme ?? 'http'
    if (n.ips.length === 0) return null
    return `${sch}://${n.ips[0]}:${n.port}`
  }

  async function generateQrCode() {
    if (networkInfo) {
      const url = networkInfo.tunnelUrl || localNetworkBaseUrl(networkInfo)

      if (url) {
        qrCodeDataUrl = await QRCode.toDataURL(url, {
          width: 240,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        })
      } else {
        qrCodeDataUrl = null
      }
    }
  }

  async function toggleAllowLan() {
    if (isTogglingLan) return
    isTogglingLan = true
    try {
      const next = !allowLanDirectAccess
      const res = await fetch('/api/onboarding/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowLanDirectAccess: next }),
      })
      if (res.ok) {
        allowLanDirectAccess = next
        await fetchNetworkInfo()
        await generateQrCode()
      }
    } catch {
      /* ignore */
    } finally {
      isTogglingLan = false
    }
  }

  async function toggleRemoteAccess() {
    if (isToggling) return
    isToggling = true
    try {
      const nextValue = !remoteAccessEnabled
      const res = await fetch('/api/onboarding/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteAccessEnabled: nextValue }),
      })
      if (res.ok) {
        remoteAccessEnabled = nextValue
        if (nextValue) {
          let attempts = 0
          const poll = async () => {
            await fetchNetworkInfo()
            if (!networkInfo?.tunnelUrl && attempts < 5) {
              attempts++
              setTimeout(poll, 1000)
            } else {
              isToggling = false
            }
          }
          poll()
        } else {
          await fetchNetworkInfo()
          isToggling = false
        }
      } else {
        isToggling = false
      }
    } catch {
      isToggling = false
    }
  }

  async function resetMagicLink() {
    if (isResetting || !confirm('This will invalidate your current remote link and all signed-in phones. Continue?')) return
    isResetting = true
    try {
      const res = await fetch('/api/onboarding/reset-magic-link', { method: 'POST' })
      if (res.ok) {
        await fetchNetworkInfo()
      }
    } catch {
      /* ignore */
    } finally {
      isResetting = false
    }
  }

  onMount(() => {
    fetchPreferences()
    fetchNetworkInfo()
  })

  async function copyToClipboard(text: string) {
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
        const successful = document.execCommand('copy')
        document.body.removeChild(textArea)
        if (!successful) throw new Error('Fallback copy failed')
      }
      copied = true
      setTimeout(() => { copied = false }, 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const showsLanToggle = $derived(networkInfo?.localUrlScheme === 'https')
  const primaryUrl = $derived(
    networkInfo
      ? networkInfo.tunnelUrl || localNetworkBaseUrl(networkInfo) || ''
      : '',
  )

  const toggleBtnBase =
    'flex w-full items-center border border-border bg-surface-2 p-3 px-4 text-left transition-all duration-200 hover:not-disabled:border-accent hover:not-disabled:bg-surface-3'
</script>

<div
  class="phone-access-panel flex h-full flex-col items-center overflow-y-auto bg-surface px-6 py-8 text-foreground"
>
  <div class="panel-content flex w-full max-w-[320px] flex-col items-center text-center">
    <div class="header-icon mb-6 bg-accent-dim p-6 text-accent">
      <Smartphone size={48} strokeWidth={1.5} />
    </div>

    <h3 class="m-0 mb-4 text-2xl font-bold">Connect Phone</h3>

    <div class="remote-toggle-container mb-6 w-full">
      <button
        class={cn(
          'remote-toggle',
          toggleBtnBase,
          remoteAccessEnabled && 'enabled border-accent-dim bg-accent-dim',
        )}
        onclick={toggleRemoteAccess}
        disabled={isToggling}
      >
        <div class={cn('toggle-icon mr-4 text-muted', remoteAccessEnabled && 'text-accent')}>
          {#if remoteAccessEnabled}
            <Globe size={18} />
          {:else}
            <Lock size={18} />
          {/if}
        </div>
        <div class="toggle-text flex flex-1 flex-col">
          <span class="label text-sm font-semibold text-foreground">Remote Access</span>
          <span class="status text-xs text-muted">{remoteAccessEnabled ? 'Enabled' : 'Local Only'}</span>
        </div>
        <div
          class={cn(
            'switch relative h-5 w-9 bg-[var(--bg-4)] transition-colors duration-200',
            remoteAccessEnabled && 'on bg-accent',
          )}
        >
          <div
            class={cn(
              'knob absolute left-0.5 top-0.5 h-4 w-4 bg-white transition-transform duration-200',
              remoteAccessEnabled && 'translate-x-4',
            )}
          ></div>
        </div>
      </button>
    </div>

    {#if showsLanToggle}
      <div class="lan-toggle-container mb-6 w-full">
        <button
          type="button"
          class={cn(
            'lan-toggle',
            toggleBtnBase,
            allowLanDirectAccess && 'enabled border-accent-dim bg-accent-dim',
          )}
          onclick={toggleAllowLan}
          disabled={isTogglingLan}
        >
          <div class="toggle-text flex flex-1 flex-col">
            <span class="label text-sm font-semibold text-foreground">Same-LAN direct (Wi‑Fi)</span>
            <span class="status text-xs text-muted">
              {allowLanDirectAccess
                ? 'Phone can open Braintunnel on your LAN (vault login required)'
                : 'Block private LAN; use tunnel or this computer'}
            </span>
          </div>
          <div
            class={cn(
              'switch relative h-5 w-9 bg-[var(--bg-4)] transition-colors duration-200',
              allowLanDirectAccess && 'on bg-accent',
            )}
          >
            <div
              class={cn(
                'knob absolute left-0.5 top-0.5 h-4 w-4 bg-white transition-transform duration-200',
                allowLanDirectAccess && 'translate-x-4',
              )}
            ></div>
          </div>
        </button>
        <p class="lan-hint m-0 mt-2 text-xs leading-tight text-muted">
          TLS-encrypted. Turn on only on networks you trust; the UI still requires your vault
          password.
        </p>
      </div>
    {/if}

    <p class="instruction mb-8 text-[0.9375rem] leading-normal text-muted">
      Scan this code with your phone to access Braintunnel {#if networkInfo?.tunnelUrl}from anywhere{:else}over your local network{/if}.
    </p>

    {#if error}
      <div class="error-msg p-8 text-danger">
        <p>Error: {error}</p>
        <button onclick={fetchNetworkInfo}>Retry</button>
      </div>
    {:else if !qrCodeDataUrl || (remoteAccessEnabled && !networkInfo?.tunnelUrl && isToggling)}
      <div class="loading flex flex-col items-center gap-4 py-12 text-muted">
        <div
          class="spinner h-6 w-6 border-2 border-border [border-top-color:var(--accent)] [animation:spin_0.8s_linear_infinite]"
        ></div>
        <p>{remoteAccessEnabled && !networkInfo?.tunnelUrl && isToggling ? 'Setting up a secure endpoint...' : 'Generating QR code...'}</p>
      </div>
    {:else}
      <div class="qr-container mb-8 bg-white p-4 [box-shadow:0_4px_20px_rgba(0,0,0,0.1)]">
        <img class="block h-60 w-60" src={qrCodeDataUrl} alt="QR Code for Phone Access" />
      </div>

      <div class="info-box mb-6 flex w-full flex-col gap-4 bg-surface-2 p-4 text-left [&_svg]:mt-0.5 [&_svg]:shrink-0">
        {#if networkInfo?.tunnelUrl}
          <div class="info-item flex gap-3 text-[0.8125rem] leading-tight text-muted">
            <ExternalLink size={16} />
            <span>This link is accessible over the internet via a secure tunnel.</span>
          </div>
        {:else}
          <div class="info-item flex gap-3 text-[0.8125rem] leading-tight text-muted">
            <Wifi size={16} />
            <span>Ensure your phone is connected to the same Wi-Fi network as this computer.</span>
          </div>
          <div class="info-item flex gap-3 text-[0.8125rem] leading-tight text-muted">
            <ShieldCheck size={16} />
            <span>This link is only accessible within your local network.</span>
          </div>
        {/if}
      </div>

      <div
        class="url-copy-box mt-auto flex w-full items-center border border-border bg-surface-3 py-0.5 pl-3 pr-0.5"
      >
        <div class="url-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted [font-family:var(--font-mono)]">{primaryUrl}</div>
        <button
          class="copy-btn flex h-8 w-8 items-center justify-center text-muted transition-colors duration-150 hover:bg-[var(--bg-4)] hover:text-foreground"
          onclick={() => copyToClipboard(primaryUrl)}
          title="Copy local URL"
        >
          {#if copied}
            <Check size={16} color="var(--accent)" />
          {:else}
            <Copy size={16} />
          {/if}
        </button>
      </div>

      {#if remoteAccessEnabled && networkInfo?.tunnelUrl}
        <div class="reset-link-container mt-4 flex w-full justify-center">
          <button
            class="reset-link-btn flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-2 py-1 text-xs text-[var(--text-3,#666)] transition-colors duration-200 hover:not-disabled:bg-surface-2 hover:not-disabled:text-muted disabled:cursor-not-allowed disabled:opacity-50"
            onclick={resetMagicLink}
            disabled={isResetting}
          >
            <RefreshCw size={12} class={isResetting ? 'spin' : ''} />
            <span>Generate new remote link</span>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* Spinner keyframes referenced by inline arbitrary `animation` utility above. */
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Lucide icon class — when present, RefreshCw spins. */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
</style>
