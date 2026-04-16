# BUG-004: Full Disk Access detection and onboarding UX

## Summary

Brain.app requires **Full Disk Access (FDA)** to read iMessage, Notes, Safari history, and Apple Mail data — but the app currently has **no runtime detection** of whether FDA has been granted, **no guided prompt** to help the user enable it, and **no relaunch** after the user toggles the permission. The app either silently fails to access protected data or shows confusing errors, with no indication of what the user should do.

This is a **ship blocker** for zero-config installs: a user who downloads the DMG and launches Brain.app should be guided through granting FDA on first launch (and on any future launch where FDA is missing), then the app should relaunch itself so the new permission takes effect immediately.

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

## Proposed UX flow

### First launch (or any launch where FDA is missing)

```
┌──────────────────────────────────────────────────┐
│                                                  │
│          🔒  Brain needs your permission          │
│                                                  │
│   Brain reads your local data (email, messages,  │
│   notes) to power your personal assistant.       │
│   macOS requires you to grant Full Disk Access   │
│   for this to work.                              │
│                                                  │
│   ┌──────────────────────────────────────────┐   │
│   │  1. Click "Open System Settings" below   │   │
│   │  2. Toggle ON the switch next to Brain   │   │
│   │  3. Brain will relaunch automatically    │   │
│   └──────────────────────────────────────────┘   │
│                                                  │
│   [ Open System Settings ]     [ Later ]         │
│                                                  │
└──────────────────────────────────────────────────┘
```

- **"Open System Settings"** → opens `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`, then starts polling.
- **"Later"** → dismisses the modal, app continues in degraded mode (features that need FDA show contextual "grant access" prompts instead of failing silently).
- After the user toggles FDA on, the app detects the change (polling the probe-read every 2 seconds) and **relaunches automatically** with a brief toast: *"Permission granted — restarting…"*

### Subsequent launches

- On every app launch, check FDA status before spawning the Node server (or immediately after).
- If FDA is granted → proceed normally.
- If FDA is revoked (user toggled it off) → show the same modal again.

### Degraded mode (user clicked "Later")

If the user skips the FDA prompt, the app should still be functional for non-FDA features (chat with external LLMs, wiki browsing, etc.). Features that require FDA (email via Apple Mail, iMessage, Notes) should show inline messages like:

> "Brain needs Full Disk Access to read your messages. [Grant Access]"

…where "Grant Access" re-triggers the onboarding modal.

## Implementation plan

### 1. Rust: FDA probe function

In `desktop/src/`, add an `fda.rs` module:

```rust
use std::fs;

/// Check FDA by probing a TCC-protected path.
/// On macOS 10.15+, this probe auto-registers the app in the FDA list.
pub fn is_full_disk_access_granted() -> bool {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return false,
    };
    // macOS 12+ (Monterey through Sequoia)
    let probe = format!("{}/Library/Containers/com.apple.stocks", home);
    fs::read_dir(&probe).is_ok()
}

/// Open System Settings directly to the FDA pane.
pub fn open_fda_system_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn();
}
```

Expose both as Tauri commands so the Svelte frontend can call them.

### 2. Tauri command + capability

Register commands in `lib.rs`:

```rust
#[tauri::command]
fn check_fda() -> bool {
    crate::fda::is_full_disk_access_granted()
}

#[tauri::command]
fn open_fda_settings() {
    crate::fda::open_fda_system_settings();
}
```

Add `"process:default"` to `desktop/capabilities/default.json` for the relaunch capability.

### 3. Svelte: onboarding modal component

A `FullDiskAccessGate.svelte` component that:

- Calls `check_fda()` on mount.
- If FDA is missing, renders the permission modal (blocking the main UI).
- "Open System Settings" button calls `open_fda_settings()` then starts a 2-second poll loop calling `check_fda()`.
- When `check_fda()` returns true, calls `relaunch()` from `@tauri-apps/plugin-process` (with a brief "Restarting…" message).
- "Later" button dismisses the modal and sets a session flag (don't re-prompt until next launch unless the user explicitly requests it).

### 4. Dependencies to add


| Package                      | Where                  | Purpose                    |
| ---------------------------- | ---------------------- | -------------------------- |
| `tauri-plugin-process`       | `desktop/Cargo.toml` | Rust-side relaunch support |
| `@tauri-apps/plugin-process` | `package.json`         | JS-side `relaunch()` API   |


No need for `tauri-plugin-macos-permissions` — the probe-read technique is simple enough to implement directly (3 lines of Rust), and avoids pulling in a dependency with accessibility/camera/microphone features we don't need.

### 5. Integration with existing startup

In `lib.rs`, the FDA check should run **before** `spawn_brain_server()` in release mode. If FDA is not granted, the server can still start (it doesn't *require* FDA for basic functionality), but the WebView should show the onboarding gate. The check result can be passed to the frontend via a Tauri command or injected as initial state.

## Edge cases

- **User grants FDA then revokes it later:** detected on next launch; re-prompt.
- **Multiple displays of the modal:** "Later" should be per-session (not persisted). Every cold launch re-checks.
- `**cargo run --release` (dev iteration):** FDA check should work identically; the probe path exists on any macOS system.
- **Non-macOS:** the FDA module should be `#[cfg(target_os = "macos")]` only. On other platforms, `check_fda()` returns `true` (no FDA concept).
- **Sandboxed builds:** FDA detection doesn't work in sandboxed apps. Brain.app is non-sandboxed (direct distribution, not App Store), so this is fine.

## Testing

- **Manual:** build release, launch without FDA granted, verify modal appears, click "Open System Settings", toggle FDA on, verify automatic relaunch, verify modal does not appear on second launch.
- **Unit test:** `is_full_disk_access_granted()` can be tested by checking that it returns a bool without panicking; actual FDA state depends on the machine.
- **Integration:** verify the "Later" flow allows the app to continue in degraded mode without crashes.

### Manual test checklist (release Brain.app)

1. Build a release DMG / run `npm run tauri:run-release` on macOS **without** Full Disk Access for Brain.
2. Launch the app — the **Full Disk Access** gate modal should appear (production Tauri only; `npm run dev` / browser should not show it).
3. Tap **Open System Settings** — Privacy & Security → Full Disk Access should open.
4. Enable **Brain**, return to the app — within a few seconds the UI should show **Permission granted — restarting…** and the app should **relaunch**.
5. After relaunch, the gate should **not** appear (FDA granted).
6. Tap **Later** on a fresh session (or clear FDA and dismiss) — onboarding/chat should load; Messages thread panel should offer **Grant Full Disk Access…** when the API returns `full_disk_access_hint`.
7. `GET /api/onboarding/fda` returns `{ granted: true | false }`; startup diagnostics log one line: `Full Disk Access: granted` or `NOT granted`.

## References

- [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess) — Swift package; probe technique and prompt UX
- [tauri-plugin-macos-permissions](https://github.com/ayangweb/tauri-plugin-macos-permissions) — Tauri v2 plugin (heavier; includes accessibility, camera, etc.)
- [@tauri-apps/plugin-process](https://v2.tauri.app/plugin/process/) — Tauri v2 relaunch API
- [DaisyDisk Full Disk Access guide](https://daisydiskapp.com/guide/4/en/FullDiskAccess) — best-in-class user-facing documentation
- [CleanMyMac FDA flow](https://macpaw.com/support/cleanmymac/knowledgebase/full-disk-access) — in-app assistant pattern
- [Apple WWDC 2018: Your Apps and the Future of macOS Security](https://developer.apple.com/videos/play/wwdc2018/702/) — Apple's recommended approach (mentions DaisyDisk at 9:22)

