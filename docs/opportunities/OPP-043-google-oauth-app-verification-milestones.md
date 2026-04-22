# OPP-043: Google OAuth App Verification — Milestone Plan

**Status: Must-do.** The project cannot ship to real users without this. Without Google verification, every user sees "This app isn't verified" on the consent screen and the project is capped at ~100 manually-added test users.

**Related:**

- [OPP-022](OPP-022-google-oauth-app-verification.md) — risk framing, scope policy, security assessment background
- [OPP-019](OPP-019-gmail-first-class-brain.md) — Gmail first-class integration (the feature this unblocks)
- [OPP-038](OPP-038-macos-developer-id-notarization-playbook.md) — macOS Developer ID signing and notarization
- [docs/google-oauth.md](../google-oauth.md) — OAuth flow technical details

---

## Current state

Braintunnel is a Google Cloud project in **testing mode**:

- OAuth works for manually-added test users (cap: ~100)
- All other users see an "unverified app" interstitial
- Restricted scopes (Gmail full access, Calendar) require Google's OAuth app verification before arbitrary users can consent

---

## Milestone map

```
M0 Brand Lock
  └─► M1 Legal Entity Decision
        └─► M2 Domain + Public Website
              └─► M3 Privacy Policy + Terms of Service
                    └─► M7 Consent Screen Completion
                          └─► M8 Submit for Verification
                                └─► M9 Third-Party Security Assessment
                                      └─► M10 Google Review + Approval

Parallel tracks (can proceed alongside M2–M7):
  M4 Scope Audit + User Data Controls
  M5 App UX Polish
  M6 macOS Developer ID + Notarization (OPP-038)
```

---

## M0: Brand lock — **complete**

**Depends on:** nothing  
**Blocks:** everything else (cleared for M1+)

**Canonical product name:** **Braintunnel** (macOS bundle `Braintunnel.app`, `desktop/tauri.conf.json` `productName`). User-facing copy, key developer docs, and this repository’s README/AGENTS describe the product as Braintunnel; the repo remains `brain-app` and env vars remain `BRAIN_*` for historical compatibility.

**Completed work items:**

- Canonical product name locked to **Braintunnel**
- UI, product docs, and developer docs swept to **Braintunnel** / `**Braintunnel.app`** (see [COPY_STYLE_GUIDE](../COPY_STYLE_GUIDE.md), [product/personal-wiki.md](../product/personal-wiki.md)); Rust/Tauri log prefixes say **Braintunnel** where they name the product
- **Intentional unchanged names:** repository `**brain-app`**, env `**BRAIN_*`**, on-disk defaults `**~/Documents/Brain**` / `**Application Support/Brain**`, component ids like `**BrainHubPage**`, and strategy language such as **“second brain”** or **brain-to-brain** in network OPPs — not the public product name

**Still optional (not blocking verification or the 100-user cap):**

- **Logo / app icon** for the Google OAuth consent screen and marketing. Google’s consent screen supports an optional logo; a polished logo helps trust but is **not** what removes the testing-mode user limit — that comes from **OAuth verification** (M8–M10: policy, security assessment, Google approval). You can submit with a **placeholder** or **text-only** branding while custom art is in progress; confirm current requirements in [Google Cloud Console](https://console.cloud.google.com/) when you file.
- Tagline and visual brand guidelines (colors, typeface) — nice for M2 public site and M7 consent screen polish, not a hard prerequisite to start M1.

**Logo and the 100-user limit:** The **~100 test-user cap** is a property of **testing** mode in Google Cloud. Moving to **production** / verified status requires completing **verification** (restricted scopes, security assessment where applicable), not merely uploading a logo. Treat logo as **quality / trust**, not the gate for user count.

---

## M1: Legal entity — **Braintunnel, LLC (in progress)**

**Depends on:** M0 (brand lock) ✅  
**Blocks:** M2 (website), M3 (policy author), M6 (Apple Developer account)

The Google consent screen shows **"Published by: entity name"**. The privacy policy must be authored by a real party. Apple Developer Program membership (required for notarization) can be individual or **organization** once the entity exists.

**Decision:** **LLC** under the name **Braintunnel, LLC** (aligned with product and domain).  
**In progress:** **Donna Wilcox** is working on **Braintunnel, LLC** formation and related setup. Track remaining filings, EIN, and operating details with her; update this doc when the entity is **active** and you have a registered agent address / official name string for policy footers and the Google consent screen.

**Work items** (owner: Donna / operators — adjust checkboxes as milestones land):

- **Entity type and name** — Braintunnel, LLC
- **Formation complete** — articles filed, state good standing (details per jurisdiction)
- **EIN** (IRS) — as applicable once formed
- **Open business bank account** (optional before assessor invoices but often useful)
- **Confirm legal copy** for M3: exact **Braintunnel, LLC** string, principal address, and contact email for privacy/TOS

---

## M2: Domain + public website — **in progress (skeleton live)**

**Depends on:** M0 (brand name) ✅  
**Blocks:** M3 (policy URLs), M7 (consent screen homepage URL)  
**Note on M1:** **Braintunnel, LLC** is **in progress** (Donna Wilcox). The site can go up under the Braintunnel brand first; **policy pages (M3)** should name **Braintunnel, LLC** as soon as the entity is active and copy is confirmed.

**Live site (skeletal):** **`https://braintunnel-www.vercel.app`** — HTTPS, Vercel. **Source:** [github.com/cirne/braintunnel-www](https://github.com/cirne/braintunnel-www) (separate repo from `brain-app`).

**Domains:** **Owned** — **`braintunnel.ai`** and other similar defensives. The **production** Vercel project is not required to be on the custom domain for every intermediate step, but the **Google OAuth consent screen** should use a **single canonical** origin you control long-term (typically `https://braintunnel.ai` once DNS → Vercel is wired). Add **`braintunnel.ai`** (and `www` if used) in [Vercel](https://vercel.com) for this project, then set **Authorized domains** in Google Cloud to match.

**Homepage strategy:** **Stealth / “coming soon”** remains the target for the **app homepage** URL. The skeleton is the shell; it does not need a full product marketing build for verification. Keep it **clean and intentional** (not a squatter or parking page).

Google requires (unchanged):

- A **homepage URL** on the OAuth consent screen — can be the **custom domain** at `/` once pointed, or a stable path on the same origin you list for the app.
- A **Privacy Policy URL** and **Terms of Service URL** — these **cannot** be placeholders when you submit for verification; M3 must supply real legal text, hosted at stable paths (e.g. `/privacy`, `/terms`) on the **same canonical origin** you use for the consent screen.

**Work items:**

- [x] **Repo + host** — [cirne/braintunnel-www](https://github.com/cirne/braintunnel-www) on **Vercel**; first deploy at `https://braintunnel-www.vercel.app` (skeletal)
- [x] **HTTPS** — via Vercel
- [ ] **Custom domain** — attach **`braintunnel.ai`** (and optional `www`) to the Vercel project; set canonical URL (apex vs `www`) for OAuth + marketing
- [ ] **Homepage** — finish stealth / coming soon content on the canonical origin
- [ ] `/privacy` — real Privacy Policy (content from M3; ship with M3)
- [ ] `/terms` — real Terms of Service (content from M3; ship with M3)
- [ ] `/support` or mailto in footer (if Google or policy asks for a contact path)
- [ ] **Google Cloud → OAuth consent screen** — when M7 nears, set **Application home page**, **Privacy policy link**, and **Terms of service link** to the final HTTPS URLs (must match **Authorized domains**)

---

## M3: Privacy Policy + Terms of Service

**Depends on:** M1 (entity = policy author), M2 (website to host them)  
**Blocks:** M7 (consent screen), M8 (verification submission)

This is the most scrutinized document during verification. The security assessment will validate that the **implementation matches what the policy claims**. Get this wrong and verification fails; misrepresent it and the app can be delisted post-verification.

**What the Privacy Policy must cover for Google's restricted scopes:**


| Topic                         | Requirement                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| What data is accessed         | Gmail messages, Calendar events — be specific                                                                                           |
| Why                           | "To power a personalized AI assistant that helps you search, summarize, and act on your own email and calendar data"                    |
| Storage                       | Where data lives (local device for desktop; hosted server for cloud), encryption at rest and in transit                                 |
| Retention                     | How long email index data, calendar cache, and OAuth tokens are kept; what triggers deletion                                            |
| User controls                 | How users delete their data, revoke Google access, and request account deletion                                                         |
| Third parties / subprocessors | LLM providers (Anthropic, OpenAI, etc.) — must be named; security assessors during review                                               |
| No ML training                | Explicit statement that user data is not used to train generalized AI/ML models (Google API Services User Data Policy hard requirement) |
| Children                      | Typical COPPA statement (app not directed at children under 13)                                                                         |
| Contact                       | Legal entity name, address or email for privacy inquiries                                                                               |


**Terms of Service must cover:** acceptable use, your right to suspend accounts, disclaimer of warranties, limitation of liability.

**Strong recommendation:** Before submission, have a **privacy counsel familiar with Google OAuth / Gmail API requirements** review both documents. This is the most common reason for failed first submissions — policy language that doesn't match actual data flows, or missing clauses that Google reviewers specifically check for.

**Work items:**

- Draft Privacy Policy covering all topics above
- Draft Terms of Service
- Legal review (privacy counsel, especially for restricted-scope Gmail/Calendar apps)
- Publish both at stable URLs on the public site (M2)
- Ensure policy accurately reflects actual implementation (scope of data stored, LLM subprocessors used, retention period)

---

## M4: Scope audit + user data controls

**Depends on:** current implementation  
**Blocks:** M7 (scope justifications on consent screen), M9 (assessor examines controls)  
**Can proceed in parallel with M2–M3**

Google reviewers and security assessors will ask: "why does this app need each scope, and what controls does the user have over their data?"

**Scope audit:**

- Document exactly which OAuth scopes are requested (see [OPP-022](OPP-022-google-oauth-app-verification.md) open questions)
- For each scope: write a one-paragraph justification ("We need `https://mail.google.com/` to sync Gmail via IMAP/XOAUTH2 for local search indexing")
- Drop any scope that is not required for a currently-shipped feature
- Consider phasing: start with minimum scopes for v1 verification; add Calendar and others in a subsequent verification update if not immediately needed

**User data controls to implement before assessment:**

- **Revoke Google access** — UI to disconnect Gmail/Calendar, deletes stored tokens and email index
- **Delete my data** — user can delete their email index, wiki, and all stored data from the app
- **Data export** (nice-to-have) — user can download their wiki and data before deletion
- **Session / token management** — clear documentation of what's stored and where (local disk under `BRAIN_HOME`; hosted server in cloud mode)

---

## M5: App UX polish

**Depends on:** M4 (scope decisions locked)  
**Blocks:** M8 (Google reviewers look at the app)  
**Can proceed in parallel with M2–M3**

Google reviewers access the app during verification. The app needs to look like a real, production-grade product — not a developer tool or half-finished prototype. Key areas:

- Onboarding flow: smooth Gmail connection, clear explanation of what access is requested and why
- Error handling for OAuth failures (token revoked, redirect_uri_mismatch)
- In-app privacy disclosure: brief explanation of what data Braintunnel accesses and why, shown before or during OAuth consent
- "Connected as email" status visible in the app; clear revoke/disconnect option
- No broken pages or obvious development-mode UI in the tested surface

---

## M6: macOS Developer ID + notarization

**Depends on:** M0 (identity), M1 (Apple Developer Program membership)  
**Blocks:** wide DMG distribution (Gatekeeper blocks unsigned downloads)  
**Can proceed in parallel with M2–M5**

See [OPP-038](OPP-038-macos-developer-id-notarization-playbook.md) for the complete playbook. This is a separate track from Google verification but a prerequisite for distributing Braintunnel.app to the test users and early-access users who will use the app during and after Google review.

**Work items (summary):**

- Join Apple Developer Program (~$99/year; can be individual or organization)
- Create Developer ID Application certificate (not App Store — see OPP-038)
- Set up notarization credentials (`APPLE_ID` + app-specific password, or App Store Connect API key)
- Run `npm run desktop:build` with signing env vars set; verify with `spctl`
- Confirm all bundled binaries (node, ripmail Mach-O) are covered by the same signing identity

---

## M7: OAuth consent screen completion

**Depends on:** M0 (name + logo), M2 (public URLs live), M4 (scope justifications written)  
**Blocks:** M8 (submission)

Fill in every field in **Google Cloud Console → APIs & Services → OAuth consent screen**:


| Field                   | Status | Notes                                                       |
| ----------------------- | ------ | ----------------------------------------------------------- |
| App name                | ☐      | Must match public brand (M0)                                |
| User support email      | ☐      |                                                             |
| App logo                | ☐      | 120×120px minimum; must match branding                      |
| App homepage URL        | ☐      | Must be live (M2)                                           |
| Privacy Policy URL      | ☐      | Must be live and accurate (M3)                              |
| Terms of Service URL    | ☐      | Must be live (M3)                                           |
| Authorized domains      | ☐      | Your public domain (M2)                                     |
| Scope descriptions      | ☐      | One sentence per scope explaining user-visible purpose (M4) |
| Developer contact email | ☐      |                                                             |


**Work items:**

- Complete all consent screen fields
- Upload logo
- Add all authorized redirect URIs for all deployment targets (see [docs/google-oauth.md](../google-oauth.md) for the full list)
- Review that scope descriptions match policy language (reviewers cross-check)

---

## M8: Submit for verification

**Depends on:** M7 (consent screen complete), M3 (policy live), M5 (app polished)  
**Blocks:** M9 (security assessment)

Submit via **Google Cloud Console → OAuth consent screen → Submit for verification** (or the current equivalent workflow — Google's UI evolves; the Console is the source of truth).

When submitting:

- Provide a clear **description of the app** and its use case ("a personal AI assistant that connects to the user's Gmail and Calendar to provide personalized help with email search, summarization, drafting, and calendar awareness — all data stays under the user's control on their own device or private hosted instance")
- Explain **why restricted scopes are needed** (IMAP OAuth for Gmail, Calendar access for scheduling context)
- Be accurate and specific; vague descriptions cause review delays

**What happens next:** For restricted scopes (Gmail full access, Calendar), Google will require a **third-party security assessment** before completing review.

---

## M9: Third-party security assessment

**Depends on:** M8 (Google initiates this after submission)  
**Blocks:** M10 (Google review)

For apps requesting restricted scopes like `https://mail.google.com/`, Google requires an assessment by a **Google-approved assessor** (examples: Leviathan Security, Bishop Fox, and others in Google's program). See [OPP-022](OPP-022-google-oauth-app-verification.md) for background.

**Budget expectation:** ~$15,000–$75,000 depending on scope breadth and assessor. This is a real cost — allocate budget before starting the verification track, and plan lead time for assessor scheduling.

**What the assessor evaluates:**

- Encryption at rest and in transit (all stored OAuth tokens, email index data)
- Access controls (who can access user data; multi-tenant isolation in hosted mode)
- Data retention matching stated privacy policy claims
- Subprocessor list accuracy (LLM providers named in policy)
- No unauthorized use of data for ML model training
- Incident response plan (basic: how would you handle a breach notification?)
- Logging and audit trail for data access

**Work items before engaging assessor:**

- Document all data flows (OAuth tokens, email index, LLM API calls with message content)
- Confirm encryption at rest for `BRAIN_HOME` data (email index SQLite) — or document the threat model (single-user local app; encryption may not be required in same way as multi-tenant cloud)
- Confirm LLM API calls transmit only user-controlled data (no cross-user leakage in hosted mode)
- Have the privacy policy finalized (assessor reads it before and during assessment)
- Prepare a basic incident response document

---

## M10: Google review and approval

**Depends on:** M9 (assessment complete and materials submitted)  
**Timeline:** ~4–6 weeks after assessment materials are submitted to Google

Google reviews the assessment report and the app itself. This phase may involve:

- Follow-up questions from Google's review team
- Requests to update consent screen text or privacy policy wording
- A second look if significant changes were made during the process

**After approval:**

- Consent screen shows as "verified" — no more "unverified app" interstitial for users
- Production access to restricted scopes for arbitrary users
- App listing in Google's OAuth directory (if applicable to your use case)
- Testing-mode user cap removed

---

## Critical path and time estimates


| Milestone                 | Est. elapsed time                                           | Cumulative  |
| ------------------------- | ----------------------------------------------------------- | ----------- |
| M0 Brand lock             | 1–2 weeks                                                   | 2 weeks     |
| M1 Legal entity           | 1–3 weeks — **Braintunnel, LLC** in progress (Donna Wilcox) | 3 weeks     |
| M2 Public website         | 1–2 weeks (skeleton on Vercel; custom domain + policy paths remaining) | 4–5 weeks   |
| M3 Privacy Policy + TOS   | 2–4 weeks (+ legal review)                                  | 7–9 weeks   |
| M4 Scope audit + controls | 2–3 weeks (parallel)                                        | —           |
| M5 App polish             | 2–4 weeks (parallel)                                        | —           |
| M6 Apple signing          | 1–2 weeks (parallel)                                        | —           |
| M7 Consent screen         | 1 week                                                      | 8–10 weeks  |
| M8 Submit                 | same day                                                    | 8–10 weeks  |
| M9 Security assessment    | 4–8 weeks                                                   | 12–18 weeks |
| M10 Google review         | 4–6 weeks                                                   | 16–24 weeks |


**Realistic total: 4–6 months from brand lock to Google approval**, assuming no re-submissions and no significant delays. **M2** is underway: a **Vercel** skeleton is live at **`https://braintunnel-www.vercel.app`**; remaining work is **custom domain**, **/privacy** + **/terms**, and a stable **canonical** origin for the consent screen.

---

## Open questions

1. **Scope set for v1 verification:** Gmail IMAP scopes only? Calendar alongside? Phased (Gmail first, add Calendar in a follow-on)?
2. **Desktop-only or hosted?** For the initial verification submission, is the primary surface Braintunnel.app (local, downloaded DMG) or `staging.braintunnel.ai` (hosted)? Google reviewers need access to the app — a hosted instance is simpler for them to evaluate. **Public marketing / www** is in **[cirne/braintunnel-www](https://github.com/cirne/braintunnel-www)** (Vercel: `https://braintunnel-www.vercel.app` today; point **`braintunnel.ai`** when ready — M2).
3. **Security assessment budget:** Have we allocated $15k–$75k? When do we need to engage an assessor relative to other milestones?
4. **LLM subprocessors in privacy policy:** Which providers are named? Do the API terms of those providers allow Braintunnel's use case? (Most do for user-initiated assistant features; worth confirming.)
5. **Multi-tenant data isolation:** For the hosted path, what is the isolation model between users? This is a primary assessor concern.

---

## Relationship to other docs

- **Public marketing site (www)** — not in this repo: [cirne/braintunnel-www](https://github.com/cirne/braintunnel-www) (deploy: `https://braintunnel-www.vercel.app`).
- [OPP-022](OPP-022-google-oauth-app-verification.md) — the background doc this plan operationalizes; see it for risk framing and scope policy guidance
- [OPP-019](OPP-019-gmail-first-class-brain.md) — the product feature (Gmail as first-class connector) that Google verification unlocks at scale
- [OPP-038](OPP-038-macos-developer-id-notarization-playbook.md) — parallel Apple signing work (M6)
- [OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md) — hosted cloud epic; the hosted instance Google reviewers would evaluate
- [docs/google-oauth.md](../google-oauth.md) — technical OAuth redirect URI setup and redirect URI list for consent screen (M7)
- [PRODUCTIZATION.md](../PRODUCTIZATION.md) — broader product readiness context (auth, multi-tenant, email setup)

