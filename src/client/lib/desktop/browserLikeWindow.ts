import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from '@tauri-apps/api/window'

/** Chrome-style default cap on very wide monitors (logical px). */
export const MAX_BROWSER_LIKE_WIDTH_LOGICAL = 1920

export function computeBrowserLikeLayout(
  workLogicalWidth: number,
  workLogicalHeight: number,
): { width: number; height: number; offsetX: number } {
  const width = Math.min(workLogicalWidth, MAX_BROWSER_LIKE_WIDTH_LOGICAL)
  const height = workLogicalHeight
  const offsetX = (workLogicalWidth - width) / 2
  return { width, height, offsetX }
}

/**
 * Resize and position the Tauri main window to roughly match a new browser window:
 * full monitor work area on typical laptops; on very wide screens, cap width and center.
 * No-ops in the web build.
 */
export async function resizeMainWindowToBrowserLikeWorkArea(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return
  }
  try {
    const monitor = await currentMonitor()
    if (!monitor) return
    const sf = monitor.scaleFactor
    const wa = monitor.workArea
    const workLogical = new PhysicalSize(wa.size.width, wa.size.height).toLogical(sf)
    const posLogical = new PhysicalPosition(wa.position.x, wa.position.y).toLogical(sf)
    const { width, height, offsetX } = computeBrowserLikeLayout(
      workLogical.width,
      workLogical.height,
    )
    const win = getCurrentWindow()
    await win.setSize(new LogicalSize(width, height))
    await win.setPosition(new LogicalPosition(posLogical.x + offsetX, posLogical.y))
  } catch {
    /* ignore: not Tauri or API denied */
  }
}
