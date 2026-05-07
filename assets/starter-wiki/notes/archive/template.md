# Archived note template

Use for **`notes/archive/<slug>.md`** — superseded meeting captures, old scratch, or digests you want to **keep** but not surface as active **`notes/`**.

**When to move here:** facts merged into **`[[people/…]]`**, **`[[projects/…]]`**, or **`[[topics/…]]`**; or the note is obsolete but still worth a paper trail.

**Mechanics:** **`move_file`** from `notes/<slug>.md` → `notes/archive/<slug>.md`. Update inbound **`[[wikilinks]]`** from **`[[index]]`** or parent pages.

## Optional front matter

```yaml
status: archived
archived: YYYY-MM-DD
superseded_by: "[[topics/canonical-topic]]"
```

## Banner

One line at top of body, e.g. **Historical — superseded by [[topics/…]].**
