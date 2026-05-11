# OPP-017 — Multimodal PDFs and local images (ripmail + agent)

**Status:** Future  
**Scope:** brain-app agent (`read_mail_message`, `read_indexed_file`, files API), ripmail CLI (`ripmail read`), local directory sources

## Problem

Many PDFs in user folders (especially from scans or exports) are **image-heavy**: large on disk but **little or no extractable text**. The near-term fix returns an **honest, token-efficient** response (`readStatus: image_heavy_pdf`, short `bodyText`, `hint`) so the agent does not hallucinate from garbage or empty bodies.

Users still expect the agent to **understand** those documents eventually—same for **raw images** attached to mail or on disk.

## Direction

1. **ripmail** exposes **image-oriented payloads** for suitable files: e.g. render PDF pages to bitmaps, surface embedded images, or return stable references to bytes on disk—over the same read/search pipeline where it makes sense.
2. **Brain** agent tools pass those payloads into **multimodal** model APIs (vision) so **images and scanned PDFs** work as naturally as text-heavy email and markdown.

## Relation to shipped work

Structured `readStatus` + hints for `ripmail read <path> --json` and localDir indexing (**no** vision, **no** image bytes in the model) is the **prerequisite**; this OPP is the **follow-on product track**.

## See also

- [ripmail OPP-051 — unified sources](archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) (**stub:** [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md))
- [Wiki read vs indexed mail/files](../architecture/wiki-read-vs-read-email.md)
