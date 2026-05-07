# Archived trip template

Use for **`travel/archive/<slug>.md`** — a **completed** trip page kept for history after durable facts are folded into **`[[topics/…]]`** or **`[[people/…]]`**.

**When to move here:** trip ended and the page is no longer your “current trip” reference; you still want logistics or narrative on disk.

**Mechanics:** use **`move_file`** from `travel/<slug>.md` → `travel/archive/<slug>.md` (rename if it avoids collisions). Fix **`[[wikilinks]]`** on **`[[index]]`** or hubs that pointed at the old path.

## Optional front matter

At the top of the file (YAML), if your vault uses it:

```yaml
status: archived
archived: YYYY-MM-DD
```

## Banner

Start the body with one line so assistants weight it as historical, e.g. **Historical — trip complete.**

## Contents

Keep the same sections as the live trip template if useful; dates and reservations are **past** — do not treat gate times or addresses as current without verifying sources for a *new* trip.
