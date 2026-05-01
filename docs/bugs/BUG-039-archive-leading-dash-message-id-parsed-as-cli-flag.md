# BUG-039: `ripmail archive` treats a leading-dash Message-ID as a CLI flag

**Former ripmail id:** BUG-062 (unified backlog 2026-05-01).

**Status:** Open  
**Tags:** `cli` · `archive` · `message-id` · `agent-surprise`  

**Related:** Possible hardening parallels with positional id handling elsewhere ([BUG-029 archived](../../ripmail/docs/bugs/archive/BUG-029-read-bare-message-id-no-angle-brackets.md), [BUG-044 archived](../../ripmail/docs/bugs/archive/BUG-044-attachment-list-ignores-message-id-flag.md)); [OPP-087 unified sources § Message-IDs](../opportunities/OPP-087-unified-sources-mail-local-files-future-connectors.md) (normalize before lookup).

---

## Summary

Some RFC 5322 `Message-ID` values **begin with `-`** after the `@` local-part. When that string is passed to **`ripmail archive`** (or tooling that forwards argv without guarding), Unix **getopt/clap** can interpret the **`leading hyphen`** as **the start of a flag** rather than the message id operand. The reporter saw this with a DigitalOcean message id shaped like `-OSgr…@geopod-ismtpd-101`; non-dash-prefixed ids archived normally.

---

## Symptom

- Archive fails only for ids whose **first character after normalization is `-`** (or when argv places the operand where a parser reads flags first).
- Error pattern is consistent with **flag parse errors**, not “message not found.”

---

## Repro

1. Identify a synced message whose **stored / CLI Message-ID begins with `-`** (angle brackets optional per existing docs).
2. Run **`ripmail archive <that-id>`** (or invoke the equivalent from the Brain mail workflow).
3. Observe CLI treating part of the id as **`--`/short flags** rather than message id text.

---

## Expected

Archive accepts any valid message id literal the indexer can resolve: require **`--` end-of-options** before operands, **`--message-id`/`-m`**, or quoting/escaping rules documented for agents — **consistent with `read`** and other id-taking commands.

---

## User feedback

- In-app issue **#10** (`2026-04-25`).
