# BUG-058: `ripmail whoami` infers wrong primary identity on shared Apple Mail

**Status:** Fixed  
**Severity:** High  
**Component:** `ripmail whoami`, Apple Mail identity inference (`src/config.rs` or equivalent whoami inference path)  
**Reported:** 2026-04-17 (brain-app onboarding debug session — runtime evidence from tool traces)

---

## Summary

On a Mac where **Apple Mail is shared across family members** (multiple `@mac.com` / `@icloud.com` accounts in the same Mail.app), `ripmail whoami` infers the **wrong person** as the primary identity.

**Confirmed bad output (Lewis's Mac, `RIPMAIL_HOME=/Users/cirne/Library/Application Support/Brain/ripmail`):**

```json
{
  "mailboxes": [
    {
      "mailboxId": "applemail_local",
      "inferred": {
        "primaryEmail": "kirstencirne@mac.com",
        "displayNameFromMail": "Kirsten Vliet"
      }
    }
  ]
}
```

Lewis (`lewiscirne@mac.com`) is the macOS user. Kirsten (`kirstencirne@mac.com`) is his wife, whose account also lives in the same Apple Mail. The correct answer is Lewis.

---

## Reproduction

1. Mac with two or more Apple Mail accounts belonging to different people in the same household.
2. One person (e.g. Kirsten) sends more outbound email than the other (e.g. Lewis) — or the Family Sharing / shared account causes her messages to dominate the outbound index.
3. Run `ripmail whoami` → returns Kirsten instead of Lewis.

**Debug evidence:**

- `ripmail search --from kirstencirne` → **480 results**
- `ripmail search --from lewiscirne` → **13 results**

The inference algorithm picks whoever sends the most mail. On this Mac, Kirsten out-sends Lewis ~37×.

---

## Root cause hypothesis

`ripmail whoami` for Apple Mail infers `primaryEmail` by looking at who appears most in the **sent** side of the indexed mailbox. When the Mac's Mail.app has multiple accounts, all outbound mail from all accounts ends up in the same `applemail_local` source and is indexed together. The person who sends the most email "wins" — regardless of which macOS user account (`/Users/<name>`) is logged in.

**What's not happening:** There is no cross-user-account `RIPMAIL_HOME` contamination. Each macOS user's `RIPMAIL_HOME` is isolated. The problem is purely that the Apple Mail local source indexes **all accounts** in Mail.app as a single pool, and inference is frequency-based.

---

## Impact

- brain-app onboarding: the "Is this you?" interstitial correctly surfaces the wrong identity, allowing the user to abort early. Without that interstitial, the profiling agent writes `me.md` for the wrong person.
- Any agent or app that calls `ripmail whoami` and trusts the result as ground truth will get the wrong person when Apple Mail is shared.

---

## Status: STILL OPEN (2026-04-17)

The bug reproduced again after restarting the machine and with only ~2,690 messages indexed.

---

## What we have tried (and why each failed)

### Attempt 1 — Outbound-frequency on Sent-path messages (original algorithm)
**Approach:** Count occurrences of apple-family addresses in `from_address` where `raw_path` matches Sent-mailbox patterns (`%sent messages%`, `%sent.mbox%`, etc.).  
**Result:** Failed. On a shared Mail.app, Kirsten sends ~480 messages vs Lewis's ~13 (37× more outbound). She wins.

### Attempt 2 — Outbound-frequency with total message count fallback (still Sent-path)
**Approach:** Same as above; when all Sent counts are zero, fall back to max total message count.  
**Result:** Same failure. Lewis sends less mail regardless of how you measure outbound volume.

### Attempt 3 — Receiver-frequency (`primary_identity_from_received`) ← current code
**Approach:** Replace outbound counting with: count how many indexed messages have each owner candidate in `To:` or `Cc:` via `json_each()`. The inbox owner should receive more mail addressed to them than a co-tenant.  
**Theory:** Correct for large, fully-indexed mailboxes. Lewis should have more incoming mail than Kirsten in his inbox.  
**Result:** Fails in practice because `lewiscirne@mac.com` is **never a candidate at all** — it never shows up in `infer_placeholder_owner_identities`. Verbose output (2,690 messages indexed):

```
[whoami]   placeholder_extra=["kirstencirne@mac.com", "jfrix01@icloud.com"]
[whoami]   owner_candidates=["applemail@local", "kirstencirne@mac.com", "jfrix01@icloud.com"]
[whoami]   receiver_count 'applemail@local': 0
[whoami]   receiver_count 'kirstencirne@mac.com': 37
[whoami]   receiver_count 'jfrix01@icloud.com': 2
[whoami]   primary elected: Some("kirstencirne@mac.com") (max_recv=37)
```

Lewis's email is completely absent. The receiver-frequency picker can't pick what isn't in the candidate list.

### Attempt 4 — Add recipient side to `infer_placeholder_owner_identities`
**Approach:** Extended the placeholder inference to query `to_addresses` and `cc_addresses` (via `json_each`) in addition to `from_address`, hoping to surface Lewis as a candidate from incoming mail.  
**Result:** Lewis still doesn't appear. With `MIN_COUNT = 5`, he either appears in fewer than 5 To/Cc fields in the current partial index (2,690 messages), or the indexed messages happen to be Kirsten's outbound mail where Lewis is not a direct recipient.

---

## Current hypothesis (unconfirmed)

**The candidate set is wrong before receiver-frequency even runs.**

`infer_placeholder_owner_identities` requires an address to appear at least `MIN_COUNT` (5) times across non-list, non-promotional messages — either as a sender or as a To/Cc recipient. With a partial index and Apple Mail syncing from newest-first:

- Kirsten's recent outbound mail dominates `from_address` counts early in the sync.
- Lewis's incoming mail (messages _addressed to_ `lewiscirne@mac.com`) may genuinely be sparse in the first 2,690 messages if recent traffic happens to be Kirsten-heavy.
- `jfrix01@icloud.com` appears only 2 times in `receiver_count` inside `whoami` — yet it was still found as a candidate by the inferrer (meaning it appeared ≥ 5 times as a _sender_). Lewis may appear as a sender fewer than 5 times in this window.

**Key unknown:** Does `lewiscirne@mac.com` actually appear in `to_addresses` of the indexed rows — and how many times? We have not yet queried the DB directly to confirm.

---

## Things not yet tried

- Query `data/ripmail/ripmail.db` directly:
  ```sql
  SELECT lower(j.value), COUNT(*) FROM messages m JOIN json_each(m.to_addresses) j
  WHERE source_id = 'applemail_local' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
  ```
  This would confirm whether Lewis's address is in the data or missing entirely.

- Lower `MIN_COUNT` in `infer_placeholder_owner_identities` (e.g. 2 or 1) to see if Lewis shows up with a small count.

- Skip `infer_placeholder_owner_identities` entirely and instead query `to_addresses` directly inside `whoami_one_mailbox` — don't require a pre-built candidate list for the placeholder case; just search all apple-family recipient addresses at once.

- Use macOS system identity (e.g. `dscl . -read /Users/$(whoami) EMailAddress`, or `defaults read MobileMeAccounts`) as a prior or tie-breaker.

- Consider whether the Apple Mail sync order (newest-first) systematically surfaces Kirsten's recent outbound before Lewis's incoming.

---

## Workaround (brain-app, shipped)

The `confirming-identity` onboarding interstitial (`state: 'confirming-identity'`) shows the whoami result and blocks the profiling agent until the user explicitly confirms or clicks "Not me — start over." This prevents a wrong profile from being written even when inference is wrong.

---

## Fix (partial — receiver-frequency picker is correct but moot until candidate list is fixed)

`primary_identity_from_received()` in `ripmail/src/search/whoami.rs` and extended `infer_placeholder_owner_identities` in `ripmail/src/search/who_infer.rs`. Regression test: `whoami_bug058_receiver_frequency_picks_correct_owner`.

---

## Related

- brain-app commit: `confirming-identity` onboarding interstitial (2026-04-17)
- [OPP-050](../opportunities/OPP-050-applemail-localhost-mailbox.md) — Apple Mail localhost mailbox source

