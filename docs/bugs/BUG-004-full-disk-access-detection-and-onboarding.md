# BUG-004: Full Disk Access detection and onboarding UX

## Status

**Implemented** (in repo). Runtime detection, a production Tauri gate modal, System Settings deep link, automatic relaunch after grant, Node/Rust probe logging, `GET /api/onboarding/fda`, and a Messages-thread degraded-mode hint are in place.

**Release sign-off:** Complete the [manual test checklist](#manual-test-checklist-release-brainapp) on a real macOS install before treating the DMG path as verified (automated tests do not replace UI/TCC interaction).

### Implemented (reference)

| Concern | Where |
| -------- | ------ |
| Rust FDA probe, `[fda]` startup logs, open FDA pane | [`desktop/src/fda.rs`](../../desktop/src/fda.rs) |
| Tauri `check_fda` / `open_fda_settings`, `tauri-plugin-process`, server spawn | [`desktop/src/lib.rs`](../../desktop/src/lib.rs) |
| `process:default` | [`desktop/capabilities/default.json`](../../desktop/capabilities/default.json) |
| Gate: prod Tauri only, poll, toast, `relaunch()` | [`src/client/lib/onboarding/FullDiskAccessGate.svelte`](../../src/client/lib/onboarding/FullDiskAccessGate.svelte) |
| Wraps app shell | [`src/client/App.svelte`](../../src/client/App.svelte) |
| Node FDA probe + startup lines (includes `Full Disk Access: granted \| NOT granted`) | [`src/server/lib/fdaProbe.ts`](../../src/server/lib/fdaProbe.ts), [`src/server/lib/startupDiagnostics.ts`](../../src/server/lib/startupDiagnostics.ts) |
| `GET /api/onboarding/fda` | [`src/server/routes/onboarding.ts`](../../src/server/routes/onboarding.ts) |
| Messages: `full_disk_access_hint` + “Grant Full Disk Access…” | [`src/server/routes/imessage.ts`](../../src/server/routes/imessage.ts), [`src/client/lib/MessageThread.svelte`](../../src/client/lib/MessageThread.svelte) |

**Note:** The gate runs only when `import.meta.env.PROD` and the Tauri runtime are both true (`FullDiskAccessGate`). `npm run tauri dev` uses the Vite dev build, so the modal does not appear there; use `npm run tauri:run-release` or a packaged app to test the gate.

### Residual (optional / future)

- **“Don’t ask again”** (persisted dismiss) — not implemented; **Later** is session-scoped only.
- **Inline FDA hints** beyond Messages (e.g. Notes, Mail library paths, other panels) — add server hints + reuse `FDA_GATE_OPEN_EVENT` from [`fdaGateKeys.ts`](../../src/client/lib/onboarding/fdaGateKeys.ts) where a feature needs parity.

---

## Summary (historical)

Brain.app requires **Full Disk Access (FDA)** to read iMessage, Notes, Safari history, and Apple Mail data. Previously the app lacked guided onboarding; that gap is addressed by the implementation above.

**Related:** [BUG-003](BUG-003-native-mac-app-ship-blockers.md) (native app ship blockers), [OPP-007](../opportunities/OPP-007-native-mac-app.md) (native Mac app packaging).

## What other apps do (research)

### The common pattern

Apps that need FDA (CleanMyMac, DaisyDisk, Raycast, Alfred, Zoom, Bartender, Backblaze, etc.) converge on the same UX:

1. **Detect** FDA status at launch (or when a feature needs it).
2. **Show a clear, non-technical modal** explaining *why* the permission is needed — one or two sentences, an icon, and two buttons: **"Open System Settings"** and **"Later"** / **"Skip"**.
3. **Open System Settings directly to the FDA pane** (`x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`), so the user doesn't have to navigate there manually.
4. **On macOS 10.15+**, simply *checking* FDA status auto-adds the app to the FDA list (unchecked) — the user just needs to toggle it on.
5. **Prompt the user to relaunch** (or relaunch automatically) because macOS only applies TCC permission changes after the process restarts.
6. Optionally offer a **"Don't ask again"** checkbox for power users who know what they're doing.

### Specific examples


| App            | Detection                          | Prompt                                              | Settings                | Relaunch                    |
| -------------- | ---------------------------------- | --------------------------------------------------- | ----------------------- | --------------------------- |
| **CleanMyMac** | Checks on first Smart Scan         | In-app "Assistant" panel with "Allow Access" button | Opens FDA pane directly | Asks user to relaunch       |
| **DaisyDisk**  | Preferences → Full Disk Access tab | Shows bouncing app icon + step-by-step instructions | Opens FDA pane directly | "Relaunch DaisyDisk" button |
| **Raycast**    | Checks at launch                   | First-run onboarding step with illustration         | Opens FDA pane directly | Relaunches automatically    |
| **Bartender**  | Checks at launch                   | Alert dialog with explanation                       | Opens FDA pane directly | Relaunches automatically    |
| **Backblaze**  | Checks at launch                   | Dedicated onboarding screen                         | Opens FDA pane directly | "Restart Backblaze" button  |


### How detection works (under the hood)

There is no public Apple API for "does this app have Full Disk Access?" The standard technique (used by the [FullDiskAccess Swift package](https://github.com/inket/FullDiskAccess), `tauri-plugin-macos-permissions`, and others) is to **probe-read a TCC-protected path**:

- **macOS 12+ (Monterey, Ventura, Sonoma, Sequoia):** try `readdir("~/Library/Containers/com.apple.stocks")`
- **macOS 10.14–11 (Mojave → Big Sur):** try `readdir("~/Library/Safari")`

If the read succeeds → FDA granted. If it fails with a permission error → FDA not granted.

**Side effect on macOS 10.15+:** performing this check automatically registers the app in the FDA list in System Settings (shown as unchecked), so the user only needs to toggle it on — they don't need to manually locate and add the app.

### How to open System Settings to the FDA pane

```
x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles
```

This URL scheme works on all macOS versions from Mojave through Sequoia. Opening it lands the user directly on Privacy & Security → Full Disk Access with the toggle list visible.

### How relaunch works

macOS applies TCC (Transparency, Consent, and Control) permission changes only when the process restarts — toggling FDA in System Settings has no effect on a running app. This is why every app that needs FDA either:

- **Automatically relaunches** after detecting the user toggled the permission, or
- **Shows a "Relaunch" button** the user clicks.

In Tauri v2, relaunch is available via:

- **JavaScript:** `import { relaunch } from '@tauri-apps/plugin-process'; await relaunch();`
- **Rust:** `app_handle.cleanup_before_exit(); tauri::process::restart(&app_handle.env());`

Both require the `@tauri-apps/plugin-process` / `tauri-plugin-process` dependency and `"process:default"` in capabilities.

## UX flow (as shipped)

### First launch (or any launch where FDA is missing)

- **"Open System Settings"** → opens the FDA pane, then polls the probe every 2 seconds.
- **"Later"** → dismisses the modal for this session; non-FDA features still work; Messages can show **Grant Full Disk Access…** when the API sets `full_disk_access_hint`.
- After the user toggles FDA on, the UI shows *Permission granted — restarting…* and **relaunches** via `@tauri-apps/plugin-process`.

### Subsequent launches

Cold launch re-checks FDA. If the user revoked FDA, the gate appears again.

### Degraded mode (user clicked "Later")

Features that need FDA should surface actionable copy. Messages uses `full_disk_access_hint` and re-opens the gate via `FDA_GATE_OPEN_EVENT` (see [`fdaGateKeys.ts`](../../src/client/lib/onboarding/fdaGateKeys.ts)).

## Edge cases

- **User grants FDA then revokes it later:** detected on next launch; re-prompt.
- **"Later"** is per-session (sessionStorage). Every cold launch re-checks.
- **`cargo run --release`:** FDA check behaves like other macOS runs; probe paths exist on typical systems.
- **Non-macOS:** Rust and Node probes report no FDA concept; gate does not apply.
- **Sandboxed builds:** FDA detection does not apply; Brain.app is distributed unsandboxed.

## Testing

- **Automated:** `cargo test` in `desktop/` (includes `fda` module); Vitest `fdaProbe.test.ts`, `onboarding.test.ts` (`/api/onboarding/fda`), `imessage.test.ts` (`full_disk_access_hint`).
- **Manual:** see checklist below.

### Manual test checklist (release Brain.app)

1. Build a release DMG / run `npm run tauri:run-release` on macOS **without** Full Disk Access for Brain.
2. Launch the app — the **Full Disk Access** gate modal should appear (production Tauri only; `npm run dev` / browser should not show it).
3. Tap **Open System Settings** — Privacy & Security → Full Disk Access should open.
4. Enable **Brain**, return to the app — within a few seconds the UI should show **Permission granted — restarting…** and the app should **relaunch**.
5. After relaunch, the gate should **not** appear (FDA granted).
6. Tap **Later** on a fresh session (or clear FDA and dismiss) — onboarding/chat should load; Messages thread panel should offer **Grant Full Disk Access…** when the API returns `full_disk_access_hint`.
7. `GET /api/onboarding/fda` returns `{ granted: true | false }`; startup diagnostics include a line **`Full Disk Access: granted`** or **`Full Disk Access: NOT granted`** (Node process), and Console / log stream can show **`[fda]`** lines from the Tauri main process.

## References

- [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess) — Swift package; probe technique and prompt UX
- [tauri-plugin-macos-permissions](https://github.com/ayangweb/tauri-plugin-macos-permissions) — Tauri v2 plugin (heavier; includes accessibility, camera, etc.)
- [@tauri-apps/plugin-process](https://v2.tauri.app/plugin/process/) — Tauri v2 relaunch API
- [DaisyDisk Full Disk Access guide](https://daisydiskapp.com/guide/4/en/FullDiskAccess) — best-in-class user-facing documentation
- [CleanMyMac FDA flow](https://macpaw.com/support/cleanmymac/knowledgebase/full-disk-access) — in-app assistant pattern
- [Apple WWDC 2018: Your Apps and the Future of macOS Security](https://developer.apple.com/videos/play/wwdc2018/702/) — Apple's recommended approach (mentions DaisyDisk at 9:22)
