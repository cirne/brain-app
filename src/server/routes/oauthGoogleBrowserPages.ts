import { Hono } from 'hono'

const app = new Hono()

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const completeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="3;url=/onboarding" />
  <title>Gmail connected — Brain</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #111; }
    p { margin: 0.75rem 0; }
    a { color: #2563eb; }
  </style>
  <script>
    /* Web: same-window OAuth left the SPA; send user back. Tauri: external tab also redirects (poll still runs in app). */
    setTimeout(function () { window.location.replace('/onboarding'); }, 600);
  </script>
</head>
<body>
  <h1>Gmail connected</h1>
  <p>Redirecting to onboarding… If nothing happens, <a href="/onboarding">continue here</a>.</p>
  <p><strong>Brain.app (desktop):</strong> you can close this tab and return to the app.</p>
</body>
</html>`

app.get('/complete', (c) => {
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(completeHtml)
})

app.get('/error', (c) => {
  const raw = c.req.query('reason') ?? 'Something went wrong during Google sign-in.'
  let text: string
  try {
    text = decodeURIComponent(raw)
  } catch {
    text = raw
  }
  const safe = escapeHtml(text)
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Google sign-in — Braintunnel</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #111; }
    p { margin: 0.75rem 0; }
  </style>
</head>
<body>
  <h1>Could not connect Gmail</h1>
  <p>${safe}</p>
  <p>Close this tab and return to Braintunnel to try again or read the message shown in the app.</p>
  <p>This page is served by your local Braintunnel server at <code>127.0.0.1</code>.</p>
</body>
</html>`
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

export default app
