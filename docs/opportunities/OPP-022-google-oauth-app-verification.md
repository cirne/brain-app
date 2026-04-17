# OPP-022: Google OAuth app verification (restricted scopes, security assessment, product readiness)

## Summary

Brain (and ripmail’s Gmail path) may request **restricted Google scopes** (e.g. full Gmail via `https://mail.google.com/`, Calendar, and potentially other Google APIs). **Technical OAuth can work locally** while the Cloud project stays in **testing** mode, but **production-grade access for arbitrary users** requires **Google’s OAuth app verification**—including branding, policy documents, and often a **third-party security assessment**. This opportunity captures **prerequisites**, **process**, **cost/timeline expectations**, and **risk framing** (including whether Google might reject the app) so we plan deliberately and align privacy/product copy with Google’s requirements.

**Related:** [OPP-019](OPP-019-gmail-first-class-brain.md), [OPP-009](OPP-009-oauth-relay-in-app.md), [docs/google-oauth.md](../google-oauth.md), [ripmail OPP-042](../ripmail/docs/opportunities/OPP-042-google-oauth-cli-auth.md).

## Prerequisites before starting verification

Verification is not “flip a switch” once the code works. Expect substantial **product and compliance** work first:

1. **Stable product identity** — pick a **real, shippable app name** (and stick to it for the consent screen and public listing).
2. **Public-facing site** — at minimum URLs Google expects for **Privacy Policy** and **Terms of Service** (and any other links required for your use case). These must accurately describe **what data you access, why, retention, and third parties** (including assessors and Google reviewers).
3. **A well-prepared application** — polished UX, clear scope justification, minimal scopes, documented data handling; the **security assessment** will probe storage, retention, and whether behavior matches the policy.

Skipping the above tends to waste cycles on resubmission or failed assessments.

## What “getting Google to bless the app” means

For **restricted/sensitive scopes**, Google expects a deliberate **OAuth App Verification** path (names and UI evolve; the Console’s **Verification** / verification-related flows are the source of truth).

Typical steps (high level):

1. **OAuth consent screen** — complete branding: app name, logo, **homepage URL**, **Privacy Policy URL**, **Terms of Service URL**, and accurate scope descriptions.
2. **Submit for verification** — via the Cloud Console workflow (e.g. verification-related entry points / “Verification Center” style UI in the project).
3. **Third-party security assessment** — for many restricted-scope apps, Google requires an assessment by a **Google-approved assessor** (e.g. firms in the ecosystem such as Leviathan Security, Bishop Fox). **Reported ballpark costs** in the wild are often on the order of **$15k–$75k** depending on scope breadth and assessor; treat as **planning numbers**, not quotes.
4. **Google review** — after assessment materials are in shape, **review timelines** are often cited in the **roughly 4–6 week** range *after* the security assessment completes; actual schedules vary.

Until verified, the project generally remains in **testing** (or equivalent): the integration can work for **developers and a limited set of test users** (commonly cited cap: **up to ~100 test users** manually listed), while **other users** see **“This app isn’t verified”** (or similar) warnings—bad for general release.

## Risk: will Google say “no” to “slurping” email?

**They do not typically refuse on a vague “that’s our moat” theory.** Google’s API and verification regime is tied to **policies, security, and data use**—not informal competition with Gmail.

**Encouraging precedent:** Gmail exposes scopes that enable **legitimate email clients** and assistants; **many third-party clients** (e.g. Superhuman, Shortwave, Hey-on-Gmail-style products, and many others) have gone through verification. **Personal email client / assistant** narratives are a known category.

**What actually raises risk:**

- **Scope combination** — **Gmail + Calendar + Docs + Sheets + …** signals **broad aggregation**; reviewers and assessors ask harder questions about **storage, minimization, and purpose limitation**.
- **Google API Services User Data Policy / Gmail API rules** — hard lines include **not using user data to train generalized AI/ML models** (unless permitted under specific terms), **not retaining more than necessary**, and **transparent disclosure** in the privacy policy.
- **Security assessment** — validates that **implementation matches** what policies and the consent screen claim (encryption, access controls, retention, subprocessors, etc.).
- **Product positioning** — reviewers are often **stricter** when the app looks like it **replaces or competes head-on** with core Google Workspace/Gmail features versus a **clear third-party tool** that uses Google data on the user’s behalf.

**Framing matters for Brain:** A positioning like **“your personal AI that helps you stay on top of mail you already authorized”** fits historical approval patterns better than **“we ingest your entire history into our LLM for unspecified purposes.”** **Privacy policy and security questionnaire** language should match **actual** retention, indexing, and model use—or verification will fail on **policy/assessment**, not on IMAP existing.

## Practical recommendations

- **Stay in testing** while iterating and while the user base is small; avoid forcing the general public through **unverified app** warnings until product and legal copy are ready.
- Before a serious verification push, involve **privacy counsel familiar with Google OAuth / Gmail API requirements** to review the **privacy policy and data flows**—that document is heavily scrutinized.
- Keep **scopes minimal**; add APIs only when features ship; document **why each scope** is needed on the consent screen and in policy.

## Non-goals (this doc)

- Replace Google’s official verification docs or pricing; link out and re-read before submission.
- Specify exact fees or timelines for a given submission (those change by project and assessor).

## Open questions

- Which **exact scope set** will Brain ship for v1 verification vs later (IMAP-related Gmail scopes vs Gmail REST vs Calendar only)?
- **Hosted vs desktop-only** distribution: does the public homepage and policy need to reflect **both** or a single primary surface?
- **Data retention caps** and **user-visible controls** (delete index, revoke Google) sufficient for assessor comfort?
