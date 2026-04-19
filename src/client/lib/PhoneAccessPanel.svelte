<script lang="ts">
  import { onMount } from 'svelte'
  import QRCode from 'qrcode'
  import { Smartphone, Wifi, Copy, Check, ShieldCheck } from 'lucide-svelte'

  let networkInfo = $state<{ ips: string[]; port: number } | null>(null)
  let qrCodeDataUrl = $state<string | null>(null)
  let copied = $state(false)
  let error = $state<string | null>(null)

  async function fetchNetworkInfo() {
    try {
      const res = await fetch('/api/onboarding/network-info')
      if (!res.ok) throw new Error('Failed to fetch network info')
      networkInfo = await res.json()
      
      if (networkInfo && networkInfo.ips.length > 0) {
        const url = `http://${networkInfo.ips[0]}:${networkInfo.port}`
        qrCodeDataUrl = await QRCode.toDataURL(url, {
          width: 240,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        })
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error'
    }
  }

  onMount(() => {
    fetchNetworkInfo()
  })

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => { copied = false }, 2000)
    } catch {
      /* ignore */
    }
  }

  const primaryUrl = $derived(networkInfo && networkInfo.ips.length > 0 
    ? `http://${networkInfo.ips[0]}:${networkInfo.port}` 
    : '')
</script>

<div class="phone-access-panel">
  <div class="panel-content">
    <div class="header-icon">
      <Smartphone size={48} strokeWidth={1.5} />
    </div>
    
    <h3>Connect Phone</h3>
    
    <p class="instruction">
      Scan this code with your phone to access Brain over your local network.
    </p>

    {#if error}
      <div class="error-msg">
        <p>Error: {error}</p>
        <button onclick={fetchNetworkInfo}>Retry</button>
      </div>
    {:else if !qrCodeDataUrl}
      <div class="loading">
        <div class="spinner"></div>
        <p>Generating QR code...</p>
      </div>
    {:else}
      <div class="qr-container">
        <img src={qrCodeDataUrl} alt="QR Code for Phone Access" />
      </div>

      <div class="info-box">
        <div class="info-item">
          <Wifi size={16} />
          <span>Ensure your phone is connected to the same Wi-Fi network as this computer.</span>
        </div>
        <div class="info-item">
          <ShieldCheck size={16} />
          <span>This link is only accessible within your local network.</span>
        </div>
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
