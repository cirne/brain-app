# Archived: OPP-029 — Desktop auto-update (Braintunnel.app)

**Archived 2026-04-30.** **Status: Partial** — updater plugin wired; **manifest `endpoints`** and signed release pipeline still open. See [AGENTS.md](../../../AGENTS.md). **Stable URL:** [stub](../OPP-029-auto-update.md).

---

# OPP-029: Desktop auto-update (Braintunnel.app)

**Tags:** `desktop` — **Short-term priority:** cloud / hosted workstreams ahead of publishable `latest.json` + signed updater artifacts.

**Status: partial (2026).** `tauri-plugin-updater` is **wired** in the Rust shell; the client can **check** and **install**; `plugins.updater.endpoints` in `tauri.conf.json` is **empty** until a team hosts a version manifest. **Still to ship:** public `latest.json` (or Tauri v2–equivalent) + signed `*.app.tar.gz`, `TAURI_SIGNING_`* in CI, and the usual **notarization** story for non-developer installs. See [AGENTS.md](../../../AGENTS.md).

## Summary

Braintunnel ships as a macOS `.app` / DMG. Today, getting a new version means rebuilding from source or manually replacing the bundle. Before any real distribution this must be solved: the app needs to detect a new release, download it silently, and offer a one-click restart into the new version.

**Related:** [OPP-007 archive](./OPP-007-native-mac-app.md) (Tauri bundling), [archived OPP-023](./OPP-023-local-https-loopback-hardening.md) (HTTPS to embedded server), [OPP-022](../OPP-022-google-oauth-app-verification.md) (distribution prerequisites).

---

## How desktop auto-update works (the general model)

Every major desktop updater (Tauri, Electron/Squirrel, Sparkle, Chromium's component updater) follows the same four-step loop:

### 1. Detect a new release

The running app periodically **polls a version endpoint** — a simple JSON file at a known HTTPS URL that the release pipeline publishes alongside each build. The response includes the latest version string, a download URL, and a cryptographic signature.

```
GET https://releases.myapp.com/latest.json

{
  "version": "0.4.2",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-04-19T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://releases.myapp.com/Braintunnel_0.4.2_aarch64.app.tar.gz",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    },
    "darwin-x86_64": { ... }
  }
}
```

The app compares the remote version against `tauri.conf.json`'s `version` field (baked at build time). If the remote is newer, proceed.

### 2. Download the update package

The update is **not** a full DMG reinstall. It is a **compressed delta of the app bundle** — on macOS, a `.app.tar.gz` (the entire `.app` directory tree repackaged as a tarball, then gzip-compressed). This is typically 30–150 MB vs a 200–300 MB DMG.

The download happens **in the background**, writing to a temp path inside `~/Library/Caches/` or the OS temp dir — not the live install location. The app continues running normally during the download.

After download, the **signature is verified** against a public key baked into the binary at build time. Any tampered or unsigned payload is rejected. This is the primary security control — without it, the update endpoint would be an arbitrary code execution vector.

### 3. Overwrite the running app — why this is safe on macOS

**The short answer:** on macOS, the filesystem holds the old `.app` open via its inode, not its path. Replacing the directory at the path does not touch the running process's memory or open file handles.

**What actually happens:**

1. The updater extracts the new `.app.tar.gz` to a **staging directory** (e.g. `/tmp/Braintunnel-update/Braintunnel.app`).
2. It uses `NSFileManager.replaceItem(at:withItemAt:)` (or equivalent POSIX `rename(2)`) to **atomically swap** the staging copy into the install path (typically `/Applications/Braintunnel.app`).
3. `rename(2)` is atomic at the VFS layer on APFS/HFS+ — the old inode stays alive (and the running process's open file descriptors keep working) while the directory entry at `/Applications/Braintunnel.app` now points to the new content.
4. The running process keeps working. The update is not "live" until the next launch.

On Windows the story is more complicated (files are locked by the OS while open) — Squirrel uses a side-by-side `app-0.4.2/` directory and a stub launcher that switches targets on restart. Not our concern for now.

### 4. User-initiated restart

The updater surfaces a **non-intrusive notification** — a badge on a menu bar icon, a banner in the UI, or a dialog — offering "Restart to update". The user clicks it, the app calls `process.exit()` (or the Tauri `relaunch` API), and the OS launches the fresh binary from the now-replaced path.

---

## Tauri v2 specifics

Tauri ships a first-party plugin (`tauri-plugin-updater`) that implements all four steps above. The integration surface is small:

`**Cargo.toml` (desktop crate):**

```toml
[dependencies]
tauri-plugin-updater = "2"
```

`**src-tauri/src/main.rs`:**

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
```

`**tauri.conf.json`:**

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<base64-encoded-public-key>",
      "endpoints": ["https://releases.braintunnel.ai/latest.json"]
    }
  }
}
```

On the frontend, a Svelte component calls the `@tauri-apps/plugin-updater` JS API:

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const update = await check();
if (update) {
  // update.version, update.body (release notes) available here
  await update.downloadAndInstall();
  await relaunch();
}
```

The plugin handles: polling, signature verification, download + staging, atomic replace, and exposes the JS surface above. Braintunnel just needs to wire a UI affordance and a release pipeline that publishes the JSON manifest and signed tarballs.

---

## Release pipeline (what has to be automated)

Each build must:

1. **Sign the update payload.** Tauri ships `tauri signer generate` to produce a keypair. The private key lives in CI secrets; the public key is baked into `tauri.conf.json`. The `tauri build` step produces a `.app.tar.gz` + `.sig` file automatically when `TAURI_SIGNING_PRIVATE_KEY` is set.
2. **Publish artifacts + manifest.** After a successful build, upload `Braintunnel_<version>_aarch64.app.tar.gz`, `Braintunnel_<version>_aarch64.app.tar.gz.sig`, and the updated `latest.json` to an S3 bucket or GitHub Releases. `latest.json` must be written **last** — it is the "flip the switch" moment.
3. **Version bump.** `tauri.conf.json` `version` field drives everything. A git tag or CI environment variable can inject it.

GitHub Releases is the simplest backend: Tauri's community `tauri-action` GitHub Action handles signing, uploading, and optionally generating the manifest JSON.

---

## Open questions

- **Where do releases live?** GitHub Releases (simplest, free) vs S3 bucket vs dedicated endpoint. GitHub Releases works out of the box with `tauri-action`.
- **Code signing + notarization.** macOS Gatekeeper will block an unsigned `.app` downloaded via the updater just as it blocks a DMG from the internet. Requires an Apple Developer account ($99/yr), a Developer ID Application cert, and `xcrun notarytool` in CI. This is a prerequisite for distributing to anyone other than ourselves — separate from the updater plumbing but must land before shipping. **Operator playbook:** [OPP-038](../OPP-038-macos-developer-id-notarization-playbook.md).
- **Check frequency.** On launch + every N hours? Configurable? A daily check on launch is the common default.
- **Rollback.** If the new version fails to start, there is no automatic rollback in Tauri's updater today. Mitigation: keep the previous `.app.tar.gz` around and document a manual recovery path; automated rollback is out of scope initially.
- **Delta updates.** Tauri ships the whole `.app` tarball, not a binary diff. Acceptable for now; `bsdiff`-based deltas can be added later if download size becomes a complaint.
- **Windows / Linux.** Tauri's updater supports all three platforms with different artifact formats (`.msi.zip` for Windows, AppImage for Linux). Not a current target but the infrastructure generalizes.

---

## Success criteria

- `Braintunnel.app` checks for updates on launch and surfaces a non-intrusive "update available" affordance in the UI.
- Download and verification happen in the background without blocking the user.
- Clicking "Restart to update" relaunches into the new version with no manual steps.
- The release pipeline produces signed artifacts and updates the manifest JSON automatically on each tagged build.
- The update binary is verified against a pinned public key; an invalid signature aborts the install.

