# BUG-061: Google Drive source — sync hangs, `search` returns nothing while listing works

**Status:** Open. **Reported:** 2026-04-23. **Tags:** google-drive, sources, sync, search, experimental

**Product context:** [brain-app OPP-045](../../../docs/opportunities/OPP-045-cloud-file-sources-drive-dropbox.md) (cloud file sources), [ripmail OPP-051](../opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) (unified sources).

**Branch:** Experimental integration work lives on git branch **`google-drive`** (not merged to `main`).

---

## Summary

- **`list` / list-drive-files style paths** (Drive metadata via API) work as expected.
- **`ripmail search`** over the Drive-backed corpus **returns no hits** (empty results) in practice.
- **`ripmail sync`** (or equivalent refresh for the Drive source) **appears to hang indefinitely** (no completion observed in normal use).

Together this blocks treating Google Drive as a reliable ingest path until diagnosed or the architecture changes.

---

## Expected

After connecting a Drive folder and running sync/refresh, indexed file content should appear in **`ripmail search`** the same way as for `localDir` sources (subject to normal FTS and source filters). Sync should complete or fail with a clear, bounded error.

---

## Open questions / hypotheses

- **Indexing path:** Files may not be written into the unified FTS tables, or may use a `source_id` / doc type that search does not join correctly.
- **Sync loop:** Possible deadlock, unbounded pagination, or await on a network call without timeout.
- **Architecture:** We may pivot to **less local mirroring** — e.g. lean on **Drive’s native query/search APIs** in **agent tools** and only pull bytes for `read`-style operations, instead of full local indexing. That would be a product/engineering decision tracked under OPP-045 rather than only this bug.

---

## Related

- When this is understood, update [OPP-045](../../../docs/opportunities/OPP-045-cloud-file-sources-drive-dropbox.md) **Implementation status** and either close this bug with root cause + fix, or split follow-ups (sync vs search vs tool-only approach).
