# Login, OTP, and verification-code email

End-user **`/ripmail`** skill detail. **Developing** ripmail: use repo **`.cursor/skills/`**, not this file.

---

## Workflow (CLI)

1. **Optional:** `ripmail refresh` — pulls new mail into the **same** local index `search` uses.
2. **Always:** `ripmail search …` — the code may **already** be indexed; **do not** assume it only appears in `refresh` output.
3. **Then:** `ripmail read <message_id>` on the best match(es) if the snippet is not enough (codes are often in the body).

**Avoid for this task:** `ripmail ask` — it can send mail-derived text to **OpenAI**; verification lookup is usually a **local** `search` + `read`. (`ripmail inbox` is local/deterministic but **`search` + `read`** is still the straightest path for codes.)

---

## Search tips

- **Recency:** `--after` / `--before` accept **ISO dates** (`YYYY-MM-DD`) or **relative** specs like `1d`, `7d`, `2w` (same family as `ripmail refresh --since`; see `ripmail search --help`). Example: `ripmail search 'verification' --after 1d --limit 15`.
- **Keywords:** run one or two FTS queries, e.g. `verification code`, `sign in`, `one-time`, `OTP`, `security code`, plus the **service name** if the user said it (`slack`, `github`, …).
- **Known sender:** `--from partial@or.domain` when the user knows who sends the code.
- **Noise:** auth mail is usually not “promotional”; default search already excludes much noise. Use `ripmail search --help` if you need `--include-noise`.
- Read JSON **`hints`**, **`returned`**, **`totalMatched`** — same as other searches ([CANONICAL-DOCS.md](CANONICAL-DOCS.md)).

---

## What to tell the user

For each candidate (or the one clear winner), surface at least:

- **Code** (or “not visible in excerpt—see full read”)
- **From** (address / name)
- **Date/time** (as returned by search/read)
- **Subject**
- **`message_id`** (if they need to open thread: `ripmail thread …`)

If **several** recent messages match, list the **newest plausible** first and say why; never guess a code from the wrong message.

---

## Security

Treat codes like **secrets** in chat: minimize quoting, don’t log full bodies unnecessarily, and don’t paste IMAP passwords or unrelated PII.
