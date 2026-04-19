<script lang="ts">
  import { onMount } from 'svelte'
  import QRCode from 'qrcode'
  import { Smartphone, Wifi, Copy, Check, ExternalLink, ShieldCheck, Globe, Lock, RefreshCw } from 'lucide-svelte'

  let networkInfo = $state<{ ips: string[]; port: number; tunnelUrl: string | null } | null>(null)
  let qrCodeDataUrl = $state<string | null>(null)
  let copied = $state(false)
  let error = $state<string | null>(null)
  let remoteAccessEnabled = $state(false)
  let isToggling = $state(false)
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
      }
    } catch {
      /* ignore */
    }
  }

  async function generateQrCode() {
    if (networkInfo) {
      const url = networkInfo.tunnelUrl || (networkInfo.ips.length > 0 ? `http://${networkInfo.ips[0]}:${networkInfo.port}` : null)

      if (url) {
        qrCodeDataUrl = await QRCode.toDataURL(url, {
          width: 240,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        })
      } else {
        qrCodeDataUrl = null
      }
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
        body: JSON.stringify({ remoteAccessEnabled: nextValue })
      })
      if (res.ok) {
        remoteAccessEnabled = nextValue
        // If we just enabled it, start polling for the tunnel URL
        if (nextValue) {
          let attempts = 0
          const poll = async () => {
            await fetchNetworkInfo()
            // If we have a tunnel URL, or if we've polled enough and have a local IP fallback
            if (!networkInfo?.tunnelUrl && attempts < 5) {
              attempts++
              setTimeout(poll, 1000)
            } else {
              isToggling = false
            }
          }
          poll()
        } else {
          // If disabled, just refresh to clear the tunnel URL
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
        // Refresh everything
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
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for non-secure contexts (like some local dev setups or older browsers)
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

  const primaryUrl = $derived(networkInfo 
    ? (networkInfo.tunnelUrl || (networkInfo.ips.length > 0 ? `http://${networkInfo.ips[0]}:${networkInfo.port}` : ''))
    : '')
</script>

<div class="phone-access-panel">
  <div class="panel-content">
    <div class="header-icon">
      <Smartphone size={48} strokeWidth={1.5} />
    </div>
    
    <h3>Connect Phone</h3>
    
    <div class="remote-toggle-container">
      <button 
        class="remote-toggle {remoteAccessEnabled ? 'enabled' : ''}" 
        onclick={toggleRemoteAccess}
        disabled={isToggling}
      >
        <div class="toggle-icon">
          {#if remoteAccessEnabled}
            <Globe size={18} />
          {:else}
            <Lock size={18} />
          {/if}
        </div>
        <div class="toggle-text">
          <span class="label">Remote Access</span>
          <span class="status">{remoteAccessEnabled ? 'Enabled' : 'Local Only'}</span>
        </div>
        <div class="switch {remoteAccessEnabled ? 'on' : ''}">
          <div class="knob"></div>
        </div>
      </button>
    </div>

    <p class="instruction">
      Scan this code with your phone to access Brain {#if networkInfo?.tunnelUrl}from anywhere{:else}over your local network{/if}.
    </p>

    {#if error}
      <div class="error-msg">
        <p>Error: {error}</p>
        <button onclick={fetchNetworkInfo}>Retry</button>
      </div>
    {:else if !qrCodeDataUrl || (remoteAccessEnabled && !networkInfo?.tunnelUrl && isToggling)}
      <div class="loading">
        <div class="spinner"></div>
        <p>{remoteAccessEnabled && !networkInfo?.tunnelUrl && isToggling ? 'Setting up a secure endpoint...' : 'Generating QR code...'}</p>
      </div>
    {:else}
      <div class="qr-container">
        <img src={qrCodeDataUrl} alt="QR Code for Phone Access" />
      </div>

      <div class="info-box">
        {#if networkInfo?.tunnelUrl}
          <div class="info-item">
            <ExternalLink size={16} />
            <span>This link is accessible over the internet via a secure tunnel.</span>
          </div>
        {:else}
          <div class="info-item">
            <Wifi size={16} />
            <span>Ensure your phone is connected to the same Wi-Fi network as this computer.</span>
          </div>
          <div class="info-item">
            <ShieldCheck size={16} />
            <span>This link is only accessible within your local network.</span>
          </div>
        {/if}
      </div>

      <div class="url-copy-box">
        <div class="url-text">{primaryUrl}</div>
        <button class="copy-btn" onclick={() => copyToClipboard(primaryUrl)} title="Copy local URL">
          {#if copied}
            <Check size={16} color="var(--accent)" />
          {:else}
            <Copy size={16} />
          {/if}
        </button>
      </div>

      {#if remoteAccessEnabled && networkInfo?.tunnelUrl}
        <div class="reset-link-container">
          <button class="reset-link-btn" onclick={resetMagicLink} disabled={isResetting}>
            <RefreshCw size={12} class={isResetting ? 'spin' : ''} />
            <span>Generate new remote link</span>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .phone-access-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1.5rem;
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
    color: var(--text);
  }

  .panel-content {
    max-width: 320px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .header-icon {
    margin-bottom: 1.5rem;
    color: var(--accent);
    background: var(--accent-dim);
    padding: 1.5rem;
    border-radius: 50%;
  }

  h3 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .instruction {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-2);
    margin-bottom: 2rem;
  }

  .remote-toggle-container {
    width: 100%;
    margin-bottom: 1.5rem;
  }

  .remote-toggle {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    transition: all 0.2s;
    text-align: left;
  }

  .remote-toggle:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--bg-3);
  }

  .remote-toggle.enabled {
    border-color: var(--accent-dim);
    background: var(--accent-dim);
  }

  .toggle-icon {
    margin-right: 1rem;
    color: var(--text-2);
  }

  .enabled .toggle-icon {
    color: var(--accent);
  }

  .toggle-text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .toggle-text .label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
  }

  .toggle-text .status {
    font-size: 0.75rem;
    color: var(--text-2);
  }

  .switch {
    width: 36px;
    height: 20px;
    background: var(--bg-4);
    border-radius: 10px;
    position: relative;
    transition: background 0.2s;
  }

  .switch.on {
    background: var(--accent);
  }

  .knob {
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }

  .switch.on .knob {
    transform: translateX(16px);
  }

  .qr-container {
    background: white;
    padding: 1rem;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    margin-bottom: 2rem;
  }

  .qr-container img {
    display: block;
    width: 240px;
    height: 240px;
  }

  .info-box {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    text-align: left;
    background: var(--bg-2);
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
  }

  .info-item {
    display: flex;
    gap: 12px;
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.4;
  }

  .info-item :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .url-copy-box {
    display: flex;
    align-items: center;
    width: 100%;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 2px 2px 12px;
    margin-top: auto;
  }

  .reset-link-container {
    margin-top: 1rem;
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .reset-link-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--text-3, #666);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .reset-link-btn:hover:not(:disabled) {
    color: var(--text-2);
    background: var(--bg-2);
  }

  .reset-link-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  .url-text {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    color: var(--text-2);
    transition: background 0.15s, color 0.15s;
  }

  .copy-btn:hover {
    background: var(--bg-4);
    color: var(--text);
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0;
    color: var(--text-2);
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-msg {
    padding: 2rem;
    color: var(--danger);
  }
</style>
