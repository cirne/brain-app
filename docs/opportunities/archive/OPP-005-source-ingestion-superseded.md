# Archived: OPP-005 (Source Ingestion Pipeline)

**Status: Superseded — archived.** The brain-app–specific upload pipeline idea was replaced by the correct approach: local files and mail as first-class sources in the **ripmail** corpus. See [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) for the implementation home.

The earlier brain-app–specific sketch (Hono upload API, app-local source registry, PDF/DOCX handlers in the web server) is archived in [archive/OPP-005-source-ingestion-brain-app-upload-pipeline.md](./OPP-005-source-ingestion-brain-app-upload-pipeline.md).

This redirect file is also archived now that OPP-005 is fully closed.

---

# OPP-005: Source Ingestion Pipeline — superseded

**Status:** **Superseded.** The product direction for **directories and files as first-class, indexed sources** (alongside mail)—unified config, crawl, text extraction, and one search/refresh story—is **[ripmail OPP-051: Unified Sources — Mail, Local Files, and Future Connectors](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)**.

**Rationale:** Local folders belong in the **ripmail** corpus and CLI (same SQLite + FTS model as email), not as a parallel upload-only pipeline in brain-app. Brain-app continues to integrate via ripmail/agent tools once OPP-051 lands; wiki-relative chat context and `WIKI_DIR` markdown remain as today.

**Historical reference:** The earlier brain-app–specific sketch (Hono upload API, app-local source registry, PDF/DOCX handlers in the web server) is archived in [archive/OPP-005-source-ingestion-brain-app-upload-pipeline.md](./archive/OPP-005-source-ingestion-brain-app-upload-pipeline.md).

## Related

- [OPP-051 (ripmail): Unified Sources](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)
- [OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md)
