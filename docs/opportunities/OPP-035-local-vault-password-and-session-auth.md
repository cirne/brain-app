# OPP-035: Local vault password + browser session (replace Basic Auth)

## Summary

Replace production **HTTP Basic Auth** (`AUTH_USER` / `AUTH_PASS`) with a **single-user vault model** (no username — Brain is one principal, like 1Password): user sets a **strong password during onboarding**, we derive secrets from it, persist only **encrypted material** under `BRAIN_HOME`, and require **re-auth on new browser sessions** (session cookie or token after unlock). Only after this works should we **accept connections from any client IP** on the bundled server (today LAN clients get `403` from the bundled allowlist — see `[bundledNativeClientAllowlist.ts](../../src/server/lib/bundledNativeClientAllowlist.ts)` / `[runtime-and-routes.md](../architecture/runtime-and-routes.md)`): network exposure becomes safe **because unauthenticated requests cannot use the API or load protected UI**.

## Problem

- **Basic Auth is the wrong UX:** browsers prompt ugly native dialogs; mobile Safari and tunnel flows are awkward; credentials live in env defaults (`lew` / `changeme`) instead of user-owned secrets.
- **Basic Auth does not match the product:** Brain is **single-tenant local-first**; “username” is meaningless. The mental model should be **unlock my vault**.
- **LAN / QR access is blocked or unsafe without a real session:** Today bundled mode uses an **IP allowlist** (loopback + Tailscale CGNAT) partly because arbitrary LAN clients could otherwise hit an HTTP server that until recently was easier to misconfigure than to use safely. A **proper login gate** removes the need for TCP-layer client filtering as the primary control.

## Where the user sets the vault password (UX)

- **Fresh install (no vault yet):** **Step 1 of the onboarding wizard** — the **first interactive product screen** inside `/onboarding` (`[Onboarding.svelte](../../src/client/lib/onboarding/Onboarding.svelte)`), **before** mail connect, profiling, or wiki seeding. Not the main chat at `/`; new users already land in onboarding while `onboarding.status` is not `done` (`[App.svelte](../../src/client/App.svelte)`).
- **Order vs other gates:** On macOS bundled builds, `**FullDiskAccessGate`** may still run first (`[FullDiskAccessGate.svelte](../../src/client/lib/onboarding/FullDiskAccessGate.svelte)`); vault creation is **the first onboarding step after** those OS-level gates, not before them.
- **Returning sessions:** If the vault exists but there is **no valid session cookie** (new browser, expired session, phone first visit): show an **unlock** screen (same `/onboarding` prefix or a dedicated route such as `/unlock` — implementation detail) with password only before rendering chat or onboarding content.

This matches the mental model: **you unlock Brain, then you configure connectors** — vault is not tucked under Hub settings later.

## Goals

1. **Onboarding:** **first wizard step:** prompt to **create a vault password** (strength hints, optional confirmation field). No separate username field.
2. **Storage:** persist verifier / wrapped key material under `BRAIN_HOME` (e.g. `**.brain_password`** or alongside other secrets per `[brain-layout.json](../../shared/brain-layout.json)`); **encrypt at rest** using a **key derived from the password** (exact KDF + format TBD — align with existing embedding patterns where sensible).
3. **Sessions:** after unlock, issue a **HttpOnly cookie** (or paired token) valid for the browser session; **new browser profile / cleared cookies / new device** requires password again (“require password on new sessions”).
4. **Server:** validate session on `**/api/*`** (and any SPA routes that must not leak without unlock); **remove Basic Auth** from the default production path once parity is reached.
5. **Phase 2:** relax **bundled-native client IP restrictions** so phones on the same Wi‑Fi can connect **only after** authentication — same session story as tunnel/remote.

## Non-goals (for this OPP)

- **Multi-user** accounts or Google-as-login for the **local vault** (see [PRODUCTIZATION.md](../PRODUCTIZATION.md) §3 for the separate cloud productization track).
- **OAuth** for Gmail stays as today ([OPP-019](./OPP-019-gmail-first-class-brain.md)); this OPP is **Brain UI/API access**, not connector identity.

## Related


| Doc / OPP                                                        | Relationship                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PRODUCTIZATION.md](../PRODUCTIZATION.md) § Authentication       | Cloud multi-user direction; **this OPP is the local single-user counterpart** before/alongside that arc.                                         |
| [OPP-008](./OPP-008-tunnel-qr-phone-access.md)                   | Tunnel + QR; pairing tokens vs long-lived secrets — session cookies after vault unlock should compose with QR flows.                             |
| [OPP-023](archive/OPP-023-local-https-loopback-hardening.md) (archived) / [OPP-036](OPP-036-trust-surface-and-local-tls-finish.md) | Core **HTTPS** to embedded server is **shipped**; follow-on **trust** / ATS polish: [OPP-036](OPP-036-trust-surface-and-local-tls-finish.md). |
| `[runtime-and-routes.md](../architecture/runtime-and-routes.md)` | Documents bundled listen address and current IP allowlist.                                                                                       |
| [BUG-003](../bugs/BUG-003-native-mac-app-ship-blockers.md)       | Embedded secrets / env inheritance — vault material must live in **user data**, not only build-time embed.                                       |


## Implementation notes (sketch)

- **Crypto:** password → KDF (e.g. Argon2id or scrypt) → wrap a **master key** used for `.brain_password` blob and/or unify with existing encryption key usage if already present in repo.
- **Recovery:** changing password, forgot-password → document as **destructive reset** or export-only for v1 (matches early-product simplicity in [AGENTS.md](../../AGENTS.md)).
- **Dev:** keep `**NODE_ENV !== 'production'`** skipping vault gate if that remains the convention, or add explicit `AUTH_DISABLED`-style escape hatch for automation only.

## Acceptance (high level)

- No Basic Auth prompt in production bundled app for normal users.
- Fresh install cannot read wiki/chat/inbox APIs without completing vault password setup + unlock.
- Documented path to enable **same-LAN phone** access without `403 Forbidden` once session auth ships (**separate PR** after this OPP’s core auth path is stable).