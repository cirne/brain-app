import { Hono } from 'hono'
import { listDeviceTokens, mintDeviceToken, revokeDeviceToken } from '@server/lib/vault/deviceTokenAuth.js'

const devices = new Hono()

devices.get('/', async (c) => {
  const rows = await listDeviceTokens()
  return c.json({ ok: true, devices: rows })
})

devices.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const rawLabel = typeof body?.label === 'string' ? body.label.trim() : ''
  if (rawLabel.length > 120) {
    return c.json({ ok: false, error: 'label_too_long' }, 400)
  }
  const minted = await mintDeviceToken({
    label: rawLabel || 'Mac Agent',
    scopes: ['ingest:imessage'],
  })
  return c.json({
    ok: true,
    device: minted.device,
    token: minted.token,
  })
})

devices.delete('/:id', async (c) => {
  const id = c.req.param('id')?.trim()
  if (!id) return c.json({ ok: false, error: 'missing_device_id' }, 400)
  const deleted = await revokeDeviceToken(id)
  if (!deleted) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true })
})

export default devices
