import { Tunnel } from 'cloudflared'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { onboardingDataDir } from './onboardingState.js'

let tunnelInstance: Tunnel | null = null
let activeTunnelUrl: string | null = null

/** Strip query string for logs — never log the magic `g` param (host GUID). */
function tunnelUrlForLog(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return '(tunnel url)'
  }
}

/**
 * Returns a persistent GUID for this specific host/client.
 * Stored in the onboarding data directory.
 */
export function getHostGuid(): string {
  const guidPath = join(onboardingDataDir(), 'host-guid.txt')
  try {
    if (existsSync(guidPath)) {
      return readFileSync(guidPath, 'utf-8').trim()
    }
  } catch {
    /* ignore */
  }
  
  const newGuid = randomUUID()
  try {
    writeFileSync(guidPath, newGuid, 'utf-8')
  } catch {
    /* ignore */
  }
  return newGuid
}

/**
 * Returns the currently active tunnel URL, if any.
 */
export function getActiveTunnelUrl(): string | null {
  return activeTunnelUrl
}

/**
 * Resolves the path to the cloudflared binary.
 * In production (Tauri bundled), it uses the sidecar binary.
 */
function getCloudflaredPath(): string | undefined {
  if (process.env.BRAIN_BUNDLED_NATIVE === '1') {
    // In Tauri, sidecars are placed in the same directory as the executable
    // or in a specific Resources folder depending on the OS.
    // However, since we are running in the bundled Node server, 
    // we need to find where Tauri put the sidecar.
    const platform = process.platform === 'darwin' ? 'apple-darwin' : ''
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const sidecarName = `cloudflared-${arch}-${platform}`
    
    // The server-bundle is in desktop/resources/server-bundle
    // The sidecar is in desktop/src-tauri/bin during build, 
    // but Tauri moves it to the app's MacOS folder.
    // For the POC, we'll check a few likely locations or rely on the 
    // cloudflared package to find it if we can't.
    const possiblePaths = [
      join(process.cwd(), '..', 'MacOS', sidecarName), // macOS bundle layout
      join(process.cwd(), sidecarName),
    ]

    for (const p of possiblePaths) {
      if (existsSync(p)) return p
    }
  }
  return undefined
}

/**
 * Starts a Cloudflare Quick Tunnel (trycloudflare.com) for the given port.
 * Sets the BRAIN_TUNNEL_URL environment variable once the tunnel is active.
 */
export async function startTunnel(port: number): Promise<string | null> {
  if (tunnelInstance) {
    return activeTunnelUrl
  }

  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN
  const customPath = getCloudflaredPath()

  if (token) {
    console.log(`[brain-app] Starting authenticated Cloudflare tunnel for port ${port}...${customPath ? ` (using sidecar: ${customPath})` : ''}`)
  } else {
    console.log(`[brain-app] Starting Cloudflare Quick Tunnel for port ${port}...${customPath ? ` (using sidecar: ${customPath})` : ''}`)
  }

  return new Promise((resolve) => {
    if (customPath) {
      process.env.CLOUDFLARE_BIN = customPath
    }

    if (token) {
      // Use the authenticated tunnel with the provided token
      // For named tunnels, we override the local service to match the active port.
      // We force protocol: 'http2' to avoid QUIC/UDP flapping issues on some networks.
      tunnelInstance = Tunnel.withToken(token, {
        '--url': `http://localhost:${port}`,
        '--protocol': 'http2'
      })
      
      // Magic URL with a persistent GUID for this host
      const guid = getHostGuid()
      activeTunnelUrl = `https://brain.chatdnd.io/?g=${guid}`
      process.env.BRAIN_TUNNEL_URL = activeTunnelUrl
      
      // Named tunnels usually take a moment to connect
      tunnelInstance.on('connected', () => {
        const safe = activeTunnelUrl ? tunnelUrlForLog(activeTunnelUrl) : '(pending)'
        console.log(
          `[brain-app] Authenticated Cloudflare tunnel connected (routing to http://localhost:${port}; public ${safe})`,
        )
        resolve(activeTunnelUrl)
      })
    } else {
      // Fallback to quick tunnel
      tunnelInstance = Tunnel.quick(`http://localhost:${port}`)

      tunnelInstance.on('url', (url: string) => {
        // Quick Tunnel: public URL is already an unguessable random hostname; no ?g= layer.
        activeTunnelUrl = url
        process.env.BRAIN_TUNNEL_URL = activeTunnelUrl
        console.log(`[brain-app] Cloudflare tunnel active: ${tunnelUrlForLog(activeTunnelUrl)}`)
        resolve(activeTunnelUrl)
      })
    }

    const verboseTunnel = process.env.BRAIN_TUNNEL_VERBOSE === '1'
    tunnelInstance.on('stdout', (data: string) => {
      if (verboseTunnel) console.log(`[cloudflared stdout] ${data}`)
    })

    tunnelInstance.on('stderr', (data: string) => {
      if (verboseTunnel) console.log(`[cloudflared stderr] ${data}`)
    })

    tunnelInstance.on('error', (err: Error) => {
      console.error('[brain-app] Cloudflare tunnel error:', err)
      resolve(null)
    })

    tunnelInstance.on('exit', (code: number | null, _signal: string | null) => {
      if (code !== 0 && code !== null) {
        console.error(`[brain-app] Cloudflare tunnel exited with code ${code}`)
      }
      tunnelInstance = null
      activeTunnelUrl = null
      delete process.env.BRAIN_TUNNEL_URL
    })
  })
}

/**
 * Stops the active Cloudflare tunnel if it is running.
 */
export function stopTunnel() {
  if (tunnelInstance) {
    console.log('[brain-app] Stopping Cloudflare tunnel...')
    tunnelInstance.stop()
    tunnelInstance = null
    activeTunnelUrl = null
    delete process.env.BRAIN_TUNNEL_URL
  }
}
