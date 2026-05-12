import type { Overlay } from '@client/router.js'

/**
 * When true, mobile slide-over shows the main chat composer below the document/email panel
 * (and opening from the hub should use the chat shell, not the hub column).
 */
export function overlaySupportsMobileChatBridge(overlay: Overlay | undefined): boolean {
  if (!overlay) return false
  switch (overlay.type) {
    case 'wiki':
    case 'file':
    case 'indexed-file':
    case 'visual-artifact':
    case 'wiki-dir':
    case 'mail-search':
      return true
    case 'email':
      return typeof overlay.id === 'string' && overlay.id.length > 0
    case 'email-draft':
      return typeof overlay.id === 'string' && overlay.id.length > 0
    default:
      return false
  }
}
