# ripmail, macOS TCC / Full Disk Access, and bundling (planning)

**Status:** Planning — to revisit **after** migrating ripmail source into this repository.  
**Related:** [BUG-004](bugs/BUG-004-full-disk-access-detection-and-onboarding.md) (FDA onboarding UX), [OPP-007 (archived)](opportunities/archive/OPP-007-native-mac-app.md) (native Mac app).

This document captures what we know today about **Full Disk Access (FDA)** on macOS, how it interacts with **Brain.app** (Tauri + bundled Node + ripmail), and **architectural options** once **ripmail is developed inside this repo** (no separate “sidecar only” checkout). It is meant to support a later decision on **signing**, **bundle layout**, and **where privileged file I/O runs** — not to prescribe implementation before the migration lands.

---

## Problem statement

Brain needs access to user data under paths protected by **Transparency, Consent, and Control (TCC)** — e.g. `~/Library/Mail`, `~/Library/Messages`, Notes-related locations, etc. The OS does **not** expose a simple API that returns “does this app have FDA?”; apps use **probe reads** of known protected paths (see BUG-004).

In production we observed a concrete split:

- The **Tauri / Rust** main process can report FDA **granted** (gate logic, `[fda]` logs).
- The **bundled Node** process serving HTTP can still get `**EPERM`** on the **same** probe paths (`stocks`, `Safari`, `Mail`): `exists: true`, `readDirOk: false`, `errnoCode: "EPERM"`.

Example (from `GET /api/onboarding/fda?detail=1`):

- `cwd` under `Brain.app/.../server-bundle` (bundled Node).
- All three probes failing with **EPERM**, not **ENOENT**.

**Implication:** “User toggled **Brain** ON in System Settings → Full Disk Access” does **not** automatically mean **every** executable inside or next to the app can read TCC-protected locations. **Which Mach-O runs the syscall** and **how it is signed / attributed** matters.

A **non-goal** for product UX: asking users to manually add buried binaries (e.g. `server-bundle/node`) via **+** in Full Disk Access.

---

## What we know about macOS (research-backed, not guaranteed forever)

### No public “inherit FDA to all children” rule

Apple **DTS** has described **high-level** scenarios (e.g. a tool run from **Terminal** vs run as a **child of an app** vs **launchd**) and stated that the **exact algorithm** for choosing the **responsible** process is **not fully documented** and **has changed** over time. See [Apple Developer Forums — FDA / command-line tools](https://developer.apple.com/forums/thread/756510).

### “Responsible process”

TCC attributes access to a **responsible** process. **Child processes do not automatically inherit FDA** in all cases. Practical pattern that **fails**: a **separate executable** with a **different code-signing story** than the host app, especially if it lives **outside** the `.app` bundle (public example: embedded CLI under `~/Library/Application Support/...` not inheriting from the main app — [anthropics/claude-code#24162](https://github.com/anthropics/claude-code/issues/24162)).

### Case study: Terminal (FDA) → ripmail (no separate FDA)

When **ripmail** is launched **from a shell** in a terminal app that **has** Full Disk Access (e.g. Ghostty, Terminal.app), **that terminal** is typically the **responsible** process for the resulting access. **ripmail** itself does **not** need its own row in the FDA list for those invocations to succeed on protected paths — this is the pattern **“process A (with FDA) runs process B (no standalone FDA grant)”** and **succeeds**, matching Apple’s high-level description that tools run from a terminal inherit the **terminal’s** TCC story.

This is the **same class of effect** as `ls ~/Library/...` working from an FDA-enabled terminal: you are measuring **the terminal’s** permission, not ripmail’s independent identity.

It **contrasts** with **Brain.app → bundled Node**: there the responsible-process chain is different (GUI app spawns a **stock** `node`), and we observed **EPERM** on Node even when the user enabled FDA for **Brain**. So “parent with FDA + child” is **not** one universal rule — **who** the OS considers responsible depends on **how** the child was started and **what** identities are involved.

### How macOS differentiates scenarios (research — not a full spec)

Apple does **not** publish the complete `tccd` algorithm. The following is distilled from **public** engineering writeups and **Apple Developer Forums** (DTS); treat it as **intent** and **observed behavior**, not a contract.

**1. “Responsible” vs literal parent PID**

TCC tries to attribute a request to **responsible code** — roughly, the **app-like identity** the user would name in System Settings, which is **not always** the direct POSIX parent. Apple DTS ([forum thread on Automation / nested apps](https://developer.apple.com/forums/thread/751802)) describes this as the nearest **“parent”** the **user knows about**, with an explicit footnote that it is **not** necessarily the parent process, and that the **algorithm is complex and evolves**.

**2. Terminal → shell → tool**

When you run a binary **from a terminal** (shell as child of Terminal.app / Ghostty / iTerm), **child processes** are often attributed to **that terminal application** for TCC purposes. The classic writeup is Qt’s **[The Curious Case of the Responsible Process](https://www.qt.io/blog/the-curious-case-of-the-responsible-process)**: launching `./MyApp` **from iTerm** made `**launchctl procinfo`** report `**responsible path = …/iTerm2**`, whereas launching the same app via **Finder** / `**open`** attributed responsibility to **MyApp itself**. The **torarnv/disclaim** tool **[documents the same model](https://github.com/torarnv/disclaim)**: *“When an application is launched via Finder, the process becomes a child of `launchd`… When a user launches executables from the terminal… the terminal application… is the responsible process…”* — so `**ripmail` in a terminal with FDA** succeeds because **FDA was granted to the terminal**, not because `ripmail` has its own row.

**3. `launchd` as parent vs “nested” under an app**

Processes **started as normal GUI apps** (typically **children of `launchd`**, or started via `**open**`) are more likely to be **their own** responsible code. Helpers **embedded** in an app bundle are often folded back to the **container** app (DTS “user never sees” nested UI). **Spawning** a **different** signing identity (e.g. **stock Node**) from a **GUI app** does not reliably follow the “terminal” story — hence **EPERM** on Node despite **Brain** being toggled ON.

**4. Opting out of inheritance (`disclaim`)**

macOS has a **private** spawn attribute path: `**responsibility_spawnattrs_setdisclaim`** (see Qt post, `**disclaim**` wrapper, and LLVM / LLDB usage) so a **child** can be **disclaimed** from the parent and become **responsible for its own** TCC permissions. Without that, children **inherit** the **parent’s** responsibility chain in many cases. This is why **IDEs** and **debuggers** historically caused “wrong app” prompts unless they **disclaim** or re-parent under `launchd`.

**5. Ghostty explicitly documents this**

[ghostty-org/ghostty#9263](https://github.com/ghostty-org/ghostty/issues/9263) states that **Ghostty** is treated as the **responsible process** for subprocesses; TCC and metrics **attach to Ghostty** — the same product class as “Terminal has FDA, so `ripmail` works.”

**Takeaway for the case study**

macOS **does not** “scan” ripmail vs terminal separately for every syscall in the way you might imagine; `**tccd`** resolves **which signed client** in `TCC.db` (or prompt) should apply, using **process tree**, **bundle identity**, **code signature (`csreq`)**, and **spawn attributes** — **underspecified** publicly. The **terminal** case study fits the **documented** pattern: **terminal = responsible**, **child CLI = covered by terminal’s grants** until **disclaimed** or **reparented** under `launchd` / `open`.

### Helpers inside the bundle

Forum history (including Apple staff) emphasizes **code identity**, bundle structure, and signing. **macOS 11.4** changed behavior around some helper / inheritance cases (CVE-2021-30713); see [Michael Tsai — macOS 11.4 and helper tools](https://mjtsai.com/blog/2021/06/01/macos-11-4-breaks-full-disk-access-for-helper-tools/). So **even** “inside the bundle” is not a permanent guarantee without ongoing validation on shipping OS versions.

### User-facing corollary

**CLI checks from Ghostty / Terminal** (e.g. `ls ~/Library/Safari`) only prove what **that terminal app** may access if **it** has FDA — **not** what **Brain’s Node** or **ripmail** can access.

---

## Current Brain architecture (today)

- **Tauri** hosts the WebView and, in release, spawns the **Node** server (bundled under `Brain.app`, e.g. `server-bundle`).
- **ripmail** is bundled inside `server-bundle/ripmail`; `desktop:bundle-server` builds it (release) and the Tauri shell sets `RIPMAIL_BIN` to the bundled path (see `desktop/src/server_spawn.rs`).
- **FDA probes** exist in:
  - **Rust** (`desktop/src/fda.rs`) — used by the native gate / `invoke`.
  - **Node** (`src/server/lib/fdaProbe.ts`) — startup diagnostics + `GET /api/onboarding/fda?detail=1`.

The **failure mode** we care about: **Node** reporting **EPERM** on probes while the user believes FDA is fully granted to “Brain.”

---

## Assumption for future work (this doc)

**ripmail source code lives in this repository** at `[ripmail/](../ripmail/)` (Cargo workspace member). The old model “separate ripmail repo + symlink into `desktop/binaries` only” is replaced by **building ripmail from the same tree** as Brain’s release pipeline.

That layout supports consolidating **signing**, **CI artifacts**, and **documentation** for “what binaries ship inside Brain.app.”

---

## Architectural directions (to evaluate after migration)

These are **options**, not commitments. Each should be validated on **real** macOS installs (Sequoia + at least one older release), with FDA on/off tests and logging.

### A) Single user-facing Mach-O, ripmail behavior via argv / subcommand

**Idea:** One **primary signed binary** (e.g. the main `Brain` executable) that can also run **ripmail-compatible** behavior when invoked with dedicated arguments (multi-call / busybox-style), so **disk access** for mail operations shares **one** on-disk identity with the app the user trusts.

**Possible benefits**

- Strong **product story**: “one Brain binary,” fewer mystery entries in Full Disk Access.
- **Warm path:** if ripmail logic runs **in-process** or re-`exec`s the **same** file without pulling in a **stock** `node`, fewer “second executable” surprises for TCC.

**Costs / risks**

- **Large engineering** lift: linking Tauri shell + ripmail into one artifact (or a carefully split static graph), build pipeline complexity, release coupling.
- **TCC is still not formally guaranteed** to collapse to one toggle — validate empirically.

### B) ripmail remains a **separate** executable inside `Brain.app`, but first-class from this repo

**Idea:** Build `ripmail` from in-repo sources; place it under `Contents/MacOS/` or another **documented** bundle location; sign it with the **same** Developer ID / team as Brain; **never** rely on **stock Node** to open `~/Library/Mail` or other TCC paths.

**Possible benefits**

- Smaller step than monolithic merging: clear separation of “mail CLI” vs “GUI shell.”
- Aligns with Apple’s **high-level** story that helpers **spawned by** an app can be attributed to the **app** as responsible code — **but** must be **verified** for your exact signing and spawn graph.

**Costs / risks**

- If **ripmail** and **Brain** don’t share a coherent **signing / bundle-ID story**, you can still see **split** behavior (same class of issue as “embedded CLI outside the bundle”).

### C) ripmail as the **only** component that performs privileged filesystem / mail-store access

**Idea:** **Node** orchestrates HTTP and calls **ripmail** (or a future in-process ripmail library); **Node** does **not** `readdir` / read Mail paths for “do we have FDA?” beyond what’s strictly necessary — or eventually **no** TCC probes in Node at all; probes run in **Rust** and/or **ripmail**.

**Benefits**

- Matches how TCC actually applies: **permission follows the process that opens the file.**
- Avoids misleading “FDA granted” from one process while another still gets **EPERM**.

---

## Performance expectations (ripmail)

Reported ballpark: **~50 ms** end-to-end for a typical search, with **~1 ms** in Rust and the rest in **SQLite / DB** work.

**Implications**

- **Latency is dominated by the database**, not Rust startup — but **per-query** `fork`+`exec` of a **separate** ripmail process could still add **non-trivial** overhead if you were budget-constrained near **50 ms**. A **long-lived** ripmail worker or **in-process** database path keeps **warm** searches fast; **cold** start can remain slower and still be acceptable.

Any bundling decision should include **one** benchmark pass on “warm search” after the new layout exists.

---

## Operational notes we already learned

- Running **Brain.app from a DMG mount** (e.g. `/Volumes/.../Brain.app`) is brittle for support; prefer `**/Applications`** for realistic FDA/TCC testing.
- `**GET /api/onboarding/fda?detail=1**` is the **HTTP** probe for the **Node** process (pid, cwd, per-path EPERM/ENOENT). `**[fda]`** logs in unified logging target the **Rust** side. Comparing the two is essential when debugging “gate says yes, mail says no.”

---

## Open questions (post–ripmail-in-repo)

1. **Signing:** Exact **Developer ID** / **Team ID** layout for every shipped Mach-O (`Brain`, `ripmail`, any embedded runtime). Goal: **minimize** extra Full Disk Access rows that look like unrelated binaries.
2. **Spawn graph:** Who **exec**s ripmail (Tauri only? Node only? Both?) and does that graph match the **responsible process** story we want under TCC?
3. **Probes:** Should FDA detection live **only** in Rust + ripmail, with Node **never** interpreting TCC paths?
4. **CI:** Build ripmail for the host triple, run smoke tests, and optionally **notarize** the full `.app` — align with OPP-007 / release docs.

---

## References (external)

- Apple Developer Forums — [Full Disk Access rules / helpers (thread)](https://forums.developer.apple.com/forums/thread/107546)  
- Apple Developer Forums — [FDA and command-line / responsible process (2024)](https://developer.apple.com/forums/thread/756510)  
- Apple Developer Forums — [Automation / nested app; DTS on “responsible code” (Quinn, 2024)](https://developer.apple.com/forums/thread/751802)  
- [Claude Code Desktop — embedded CLI not inheriting FDA](https://github.com/anthropics/claude-code/issues/24162) (illustrative of **split signing / outside bundle**)  
- [Ghostty — responsible process / TCC attribution to terminal (#9263)](https://github.com/ghostty-org/ghostty/issues/9263)  
- [Michael Tsai — macOS 11.4 and helper tools / TCC](https://mjtsai.com/blog/2021/06/01/macos-11-4-breaks-full-disk-access-for-helper-tools/)  
- [Michael Tsai — Curious Case of the Responsible Process (roundup)](https://mjtsai.com/blog/2025/07/07/the-curious-case-of-the-responsible-process/)  
- Qt blog — [The Curious Case of the Responsible Process](https://www.qt.io/blog/the-curious-case-of-the-responsible-process) (launchd vs terminal, `launchctl procinfo`, `disclaim`)  
- [torarnv/disclaim](https://github.com/torarnv/disclaim) — CLI wrapper using `responsibility_spawnattrs_setdisclaim` (background + links)

---

## Summary

- **FDA is per-process / per code identity**, not “I toggled Brain once so every helper is covered.”  
- **Bundled Node** showed **EPERM** on standard probes even when folders exist — a **strong signal** to stop treating Node as the source of truth for “can we read Mail?”  
- After **ripmail lives in this repo**, the high-value follow-ups are: **signing discipline**, **spawn graph**, and **moving privileged I/O (and possibly probes) off Node** — optionally toward **one** shipped identity (single binary or tightly coupled in-bundle ripmail).

Revisit this document when the ripmail migration branch lands and we can attach **concrete paths**, **Cargo/workspace layout**, and **release checklist** items.