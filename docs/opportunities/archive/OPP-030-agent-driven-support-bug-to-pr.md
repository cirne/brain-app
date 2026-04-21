# Archived: OPP-030 — Agent-driven support (bug → PR)

**Status: Deprioritized — archived 2026-04-21.** Support automation pipeline not on the near-term roadmap; manual triage and docs remain the path.

---

# OPP-030: Agent-driven support — snag → diagnostics → triage → fix PR → user notify

## Summary

Close the loop from **user pain** to **shipped fix** without turning Brain into a silent telemetry hose. When someone hits a snag, **tools and agents notice** (explicit failure signals, structured logs, user-visible errors—not vibe-based guessing), package a **diagnostic bundle and bug report** with **clear scope and explicit permission**, and send it upstream. On the **Brain dev** side, **agents and automation** help **process** incoming issues: triage, dedupe, minimal repro, and **draft pull requests** with fixes. **Maintainers** stay in the loop: they **review the bug and the patch** and **integrate** what ships. The **user is notified** when a fix is available (in-app, release notes, or optional email), complementing distribution paths like [OPP-029](OPP-029-auto-update.md) (auto-update).

**Related:** [OPP-001](OPP-001-agent-to-agent.md) (broader agent coordination); in-product diagnostics patterns in [.agents/skills/desktop/SKILL.md](../../.agents/skills/desktop/SKILL.md) (logs, FDA, ports, `BRAIN_HOME`); manual bug write-ups under [`docs/bugs/`](../bugs/).

---

## Problem

Today, friction reports are **ad hoc**: screenshots, Discord threads, or private messages. That hides **repro steps**, **version + platform**, and **log context**, and it does not connect cleanly to **code** or **releases**. The maintainers want **faster, cheaper** paths from symptom to patch; users want **confidence** that reporting is **safe and optional** and that they **hear back** when something is fixed.

---

## Intended flow (end to end)

### 1. User hits a snag

Examples: sync failure, crash loop, webview on wrong port, OAuth callback mismatch, ripmail CLI error surfaces in chat. The failure should be **observable**—exit codes, thrown errors, structured log lines—not inferred from chat tone alone.

### 2. Tools notice; offer a report

- **Client or agent** detects a known class of failure (e.g. HTTP 5xx from embedded server, ripmail nonzero exit, Tauri permission denial).
- UI: short explanation + **“Send bug report?”** with a **checkbox list** of what will be included (app version, OS, recent log excerpt, redacted paths, last N tool calls metadata—**no** full mailbox contents by default).
- **No silent upload.** Sending requires an explicit user action (and optional settings default for “always ask”).

### 3. Structured submission

Payload should be **machine-friendly** (JSON schema or issue template) so dev-side agents can parse: title suggestion, severity guess, component tags, attached log blob, git/build id if present. Destination is an open question (GitHub Issues, Linear, private endpoint, email bridge)—must align with maintainer workflow.

### 4. Dev-side processing (agents + humans)

- **Triage automation:** dedupe against recent issues, label, route to area owners, link to related code paths.
- **Fix automation (bounded):** agents propose branches/PRs with tests where feasible; **no merge without human review** for production code.
- **Maintainer responsibility:** reproduce or validate repro, review patch quality and security implications, approve merge, decide release vehicle.

### 5. User notified of fix

Correlate the original report ID with a **closed issue** or **release**; surface **in-app** (“Your report #123 is fixed in 0.4.3”) and/or release notes. Works well with [OPP-029](OPP-029-auto-update.md) so the fix actually reaches installed clients.

---

## Non-goals (initially)

- **Full** autonomous production deploys without review.
- **Background** upload of logs or content without consent.
- Replacing human judgment on **security- or privacy-sensitive** fixes.

---

## Open questions

- **Ingress:** public GitHub vs private tracker vs hybrid (public title, private attachments)?
- **Redaction:** path anonymization, token stripping, configurable “strict” vs “diagnostic” bundles.
- **Correlation:** stable **report ID** stored locally so UX can show status later.
- **Abuse:** rate limits, captcha, or account gating if the endpoint is public.
- **Ripmail split:** which failures are **brain-app** vs **ripmail** crates—and whether ripmail gets its own slim report hook ([ripmail/docs/OPPORTUNITIES.md](../../ripmail/docs/OPPORTUNITIES.md) cross-link when touching both).

---

## Success criteria

- User can **opt in** to send a **structured** report that includes enough signal for **repro** without defaulting to oversharing.
- Dev workflow has a **single place** where incoming reports become **trackable issues** and optional **PR drafts**.
- **Humans** review and merge; automation **reduces time-to-patch**, not accountability.
- User receives a **clear notification** when the issue affecting them is **resolved** or **shipped**.
