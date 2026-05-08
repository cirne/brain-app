# Manual Testing Requirements

This document outlines workflows that are difficult to automate due to browser interactions, native OS permissions, or complex real-world data dependencies.

## OAuth and Sync Workflows

### 1. Google OAuth Flow
**Why Manual?** Requires real browser interaction and Google account consent.
- **Steps**:
  1. Run `ripmail setup --google-oauth --email <your-email>`.
  2. Verify the browser opens to the Google sign-in page.
  3. Complete the login and grant permissions.
  4. Verify the terminal shows "signed in" and `RIPMAIL_HOME/<mailbox_id>/google-oauth.json` is created.
  5. Run `ripmail status --imap` to verify the token works.

### 2. Apple Calendar Sync (macOS)
**Why Manual?** Requires macOS TCC (Transparency, Consent, and Control) permissions for EventKit.
- **Steps**:
  1. Run `ripmail sources add --kind appleCalendar`.
  2. Run `ripmail refresh --foreground`.
  3. Verify macOS prompts for "Calendar" access.
  4. Grant access and verify events are indexed (`ripmail calendar today`).

### 3. SSE Sync Progress UI
**Why Manual?** Involves real-time streaming state and complex UI feedback.
- **Steps**:
  1. Open the Brain web UI.
  2. Click "Sync All" or "Refresh" in the sidebar/onboarding.
  3. Verify that progress bars update in real-time as `ripmail` processes batches.
  4. Verify that the "Last synced" timestamp updates upon completion.

### 4. IMAP Batch Fetch Stability
**Why Manual?** Performance and timeout behavior with large mailboxes (>10,000 messages) is hard to simulate with fakes.
- **Steps**:
  1. Configure a large Gmail account.
  2. Run `ripmail refresh --backfill --foreground`.
  3. Verify that the process doesn't hang or crash during long-running batch fetches.
  4. Check `RIPMAIL_HOME/logs/sync-*.log` for any "UID FETCH batch failed" warnings.

## Enron demo tenant (no Google OAuth)

For **automated browser or API testing** with the public Enron mailboxes under **the same `./data` tree as `npm run dev`**, set **`BRAIN_ENRON_DEMO_SECRET` in `.env`**, run **`npm run brain:seed-enron-demo:dev`** once to seed **Kean, Lay, and Skilling**, then use `POST /api/auth/demo/enron` with `{ "demoUser": "kean" }` (or `lay` / `skilling`) or **`npm run test:e2e:playwright`** with **`npm run dev`** on **:3000** — see [architecture/enron-demo-tenant.md](architecture/enron-demo-tenant.md) and [`tests/e2e/README.md`](../tests/e2e/README.md). For **ripmail-only** checks against the eval index (`data-eval/brain`, Kean-only), run `npm run test:e2e:enron` after `npm run eval:build`.

## UI and Agentic Workflows

### 5. Agent Tool Execution
**Why Manual?** Requires LLM reasoning and real-world side effects (like reading local files).
- **Steps**:
  1. Ask the agent: "What's on my calendar for next Tuesday?"
  2. Verify the agent calls the `calendar` tool and correctly summarizes the results.
  3. Ask: "Find the email from last week about the project kickoff."
  4. Verify the agent uses `search` and `read` tools effectively.
