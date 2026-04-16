# BUG-043: RFC 2047–encoded subjects not decoded in CLI text or JSON

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** read, search, inbox, mime, ux, agent-first

**Design lens:** [Agent-first](../../VISION.md) — subjects should be human-readable and matchable in JSON without agents re-implementing MIME word decoding.

---

## Summary

Messages whose `Subject` is encoded per RFC 2047 (`=?UTF-8?Q?...?=`) are shown as raw encoded strings in `--text` output and in JSON `subject` fields, instead of decoded Unicode text.

**Expected:** `Subject: Re: Missional AI – find 30 minutes on Wednesday?`  
**Actual:** `Subject: =?UTF-8?Q?Re=3A_Missional_AI_=E2=80=93_find_30_minutes_on_Wedn?= =?UTF-8?Q?esday=3F?=`

---

## Affected surfaces (reported)

- `ripmail read <id> --text` — Subject line  
- `ripmail search --text` — subject column  
- `ripmail inbox` — JSON `subject` on items  
- JSON consumers generally — raw encoded strings complicate display and matching  

---

## Reported context

- **Session:** ztest / agent UAT, 2026-04-11  
- **ripmail:** 0.1.6  
- **Common sources:** Clients that MIME-encode subjects (e.g. non-ASCII or long subjects)  

---

## Root causes

Display and JSON formatting paths likely emit the stored header string without passing through a MIME word decoder.

---

## Recommendations

1. Decode RFC 2047 (and related) for subject (and any other affected headers) at format time for both text and JSON.  
2. Add regression tests with multi-chunk encoded subjects.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Feedback: `riptest/feedback/bug-encoded-subjects-not-decoded-in-text-output.md` (processed 2026-04-11)
