/**
 * Self-signed TLS for the bundled (Brain.app) embedded Hono server (OPP-023).
 * Key + cert live under `$BRAIN_HOME/var/`; see shared/brain-layout.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import selfsigned from 'selfsigned'
import { brainHome } from './brainHome.js'

const KEY_NAME = 'embedded-server-tls.key.pem'
const CERT_NAME = 'embedded-server-tls.cert.pem'

function paths() {
  const v = join(brainHome(), 'var')
  return { varDir: v, keyPath: join(v, KEY_NAME), certPath: join(v, CERT_NAME) }
}

/** Paths for tests / diagnostics. */
export function embeddedServerTlsPemPaths(): { varDir: string; keyPath: string; certPath: string } {
  return paths()
}

/**
 * Read existing PEMs or create a 10-year self-signed cert for localhost + 127.0.0.1.
 * Called once per bundled listen before `https.createServer`.
 */
export async function ensureEmbeddedServerTls(): Promise<{ key: string; cert: string }> {
  const { varDir, keyPath, certPath } = paths()
  await mkdir(varDir, { recursive: true, mode: 0o700 })
  try {
    const [key, cert] = await Promise.all([readFile(keyPath, 'utf-8'), readFile(certPath, 'utf-8')])
    return { key, cert }
  } catch {
    // selfsigned: replace `extensions` entirely, so include defaults + our SANs (node-forge types).
    const pems = selfsigned.generate(
      [{ name: 'commonName', value: 'Braintunnel Local' }],
      {
        keySize: 2048,
        days: 3650,
        algorithm: 'sha256',
        extensions: [
          { name: 'basicConstraints', cA: true },
          {
            name: 'keyUsage',
            keyCertSign: true,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true,
          },
          {
            name: 'subjectAltName',
            altNames: [
              { type: 2, value: 'localhost' },
              { type: 7, ip: '127.0.0.1' },
            ],
          },
        ],
      }
    )
    const key = pems.private
    const cert = pems.cert
    await writeFile(keyPath, key, { mode: 0o600 })
    await writeFile(certPath, cert, { mode: 0o644 })
    return { key, cert }
  }
}
