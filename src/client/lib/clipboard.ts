/**
 * Copy text to the system clipboard. Uses the Clipboard API when available;
 * otherwise falls back to a hidden textarea + `document.execCommand('copy')`.
 *
 * @returns true if copy likely succeeded, false on failure or denial.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = text.trim()
  if (!value) return true

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }

    const textArea = document.createElement('textarea')
    textArea.value = value
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    textArea.style.top = '-999999px'
    textArea.setAttribute('readonly', '')
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textArea)
    return ok
  } catch {
    return false
  }
}
