# OPP-038: macOS Developer ID signing + notarization playbook (Braintunnel / Brain.app)

**Status: open (2026).** No repo-automated release pipeline for Apple signing yet; this document captures the **intended operator workflow** for low-friction distribution (e.g. ~50 testers downloading a DMG). **Related:** [OPP-029](OPP-029-auto-update.md) (updater uses separate `TAURI_SIGNING_`* keys), [OPP-036](OPP-036-trust-surface-and-local-tls-finish.md) (TLS to localhost vs OS trust), [docs/ripmail-macos-tcc-and-bundling.md](../ripmail-macos-tcc-and-bundling.md) (every shipped Mach-O should share a coherent identity). Official Tauri reference: [macOS code signing](https://v2.tauri.app/distribute/sign/macos/), [environment variables](https://v2.tauri.app/reference/environment-variables/).

## Summary

**Goal:** Ship a **Developer ID–signed**, **notarized**, **stapled** `.app` / `.dmg` so Gatekeeper does not block quarantined downloads. Tauri 2 can perform **sign + notarize + staple** during `tauri build` when credentials are present.

**Non-goals here:** Public PKI for `127.0.0.1` (see OPP-036); LLC or company entity (individual Apple Developer Program membership is sufficient).

---

## 1. Prerequisites

- **Apple Developer Program** (paid) membership.
- **Certificate type:** **Developer ID Application** — for distribution **outside** the Mac App Store. Do not confuse with “Apple Development” (Xcode dev) or “Apple Distribution” (App Store).
- **Machine:** Builds that code-sign must run on **macOS** (Apple’s requirement for the signing toolchain).

---

## 2. One-time: create and install the signing certificate

1. Create a **Certificate Signing Request (CSR)** on the Mac that will sign releases (Keychain Access → Certificate Assistant).
2. In [Certificates, IDs & Profiles](https://developer.apple.com/account/resources/certificates/list), create **Developer ID Application**, upload the CSR, download the `.cer`, and install it into the **login** keychain.
3. List signing identities:
  ```bash
   security find-identity -v -p codesigning
  ```
   The **full string** for the Developer ID line (e.g. `Developer ID Application: Your Name (TEAMID)`) is the **signing identity** used as `**APPLE_SIGNING_IDENTITY`** or `bundle > macOS > signingIdentity` in Tauri config (see Tauri docs).

---

## 3. One-time: notarization credentials (choose one)

**Option A — Apple ID + app-specific password**

- Generate an **app-specific password** at [appleid.apple.com](https://appleid.apple.com/) (not your main Apple ID password).
- Use:
  - `**APPLE_ID`** — Apple ID email
  - `**APPLE_PASSWORD`** — app-specific password
  - `**APPLE_TEAM_ID**` — 10-character Team ID from [Membership](https://developer.apple.com/account)

**Option B — App Store Connect API key (preferred for CI)**

- Create a key under App Store Connect → Users and Access → Integrations; set `**APPLE_API_ISSUER`**, `**APPLE_API_KEY`**, `**APPLE_API_KEY_PATH**` per [Tauri’s macOS signing page](https://v2.tauri.app/distribute/sign/macos/).

If notarization env vars are **unset**, Tauri **skips** notarization (fine for unsigned experiments; **not** for wide tester distribution).

---

## 4. Release build (this repository)

From the repo root, always match Node via `**.nvmrc`** before `npm` / `npx` (see [AGENTS.md](../../AGENTS.md)):

```bash
nvm use
npm install   # if needed
```

**Signing (local keychain):** export the identity, then build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"
```

**Notarization:** in the same shell, export `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (or the API key trio), then:

```bash
npm run desktop:build
```

That runs `tauri build`, which executes `beforeBuildCommand` (production client + server + `desktop:bundle-server`, including embedded `node` and release `ripmail`).

**CI without the login keychain:** use `**APPLE_CERTIFICATE`** (base64-encoded `.p12`) and `**APPLE_CERTIFICATE_PASSWORD`** as documented by Tauri — import into a temporary keychain on the runner, then sign.

---

## 5. Artifacts

With the workspace layout in this repo, bundles typically land under `**target/release/bundle/**` (e.g. `**dmg/**` and `**macos/**`). The product name in `[desktop/tauri.conf.json](../../desktop/tauri.conf.json)` is **Braintunnel** — look for `**Braintunnel.app`** and the generated `**.dmg`**.

---

## 6. Verification before shipping

```bash
spctl -a -vv -t install /path/to/Braintunnel.app
```

Expect **accepted** with **source=Notarized Developer ID** when notarization succeeded.

Optional:

```bash
xcrun stapler validate /path/to/Braintunnel.app
```

---

## 7. Do not confuse Apple signing with Tauri updater signing


| Mechanism                                                             | Purpose                                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Developer ID + notarization + staple**                              | macOS **Gatekeeper** trust for downloaded `**.app` / `.dmg`**.                                                                           |
| `**TAURI_SIGNING_PRIVATE_KEY` / updater pubkey in `tauri.conf.json`** | Cryptographic signatures for Tauri’s **delta updater** artifacts (`.app.tar.gz` + `.sig`) only. Does **not** replace Apple code signing. |


See [OPP-029](OPP-029-auto-update.md).

---

## 8. Bundle contents note

The packaged app embeds `**node`**, `**ripmail`**, and other Mach-O binaries under `resources/server-bundle/`. **Every** nested binary must be covered by the same signing / notarization story; split or ad-hoc identities can cause TCC / FDA confusion (see [docs/ripmail-macos-tcc-and-bundling.md](../ripmail-macos-tcc-and-bundling.md)).

---

## 9. Success criteria (this OPP)

- A maintainer can follow this doc and produce a **notarized** DMG **without** ad-hoc tester instructions (no “right-click Open” workaround).
- Optional follow-on: **CI job** (e.g. `tauri-apps/tauri-action` or custom) that sets secrets and uploads artifacts — can close this OPP or spawn a thin “automation” follow-up.

