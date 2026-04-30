/** POST bodies for `/api/your-wiki/resume` (matches server contract). */
export function yourWikiResumeTimezonePayload(): { timezone: string } {
  return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

export function postYourWikiPause(): Promise<Response> {
  return fetch('/api/your-wiki/pause', { method: 'POST' })
}

export function postYourWikiResume(): Promise<Response> {
  return fetch('/api/your-wiki/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(yourWikiResumeTimezonePayload()),
  })
}
