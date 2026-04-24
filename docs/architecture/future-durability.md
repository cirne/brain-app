# Future: consolidated durable app state (SQLite)

**Status:** Direction only — **not implemented** as the primary store today.

Chat history is **JSON files** under `$BRAIN_HOME/chats` (see [agent-chat.md](./agent-chat.md) for current API and limitations). At some point we will likely move **app-level durable state** into **SQLite** so the Node server can query, cap, and search without scanning a directory of JSON files. The rough shape:

- **Per-user (or per-tenant) databases** where isolation requires it, reproducing the **ripmail pattern** (local SQLite that already works well for mail) but for data owned by the brain **app** process: **chat history**, **preferences**, and similar.
- Still **separate** from:
  - Ripmail’s SQLite under `RIPMAIL_HOME` (mail index; different domain)
  - Wiki markdown files under `$BRAIN_WIKI_ROOT/wiki` (bundled macOS: `~/Documents/Brain/wiki`; dev: `$BRAIN_HOME/wiki`)

Until then, file-based chat storage and the existing `GET /api/chat/sessions` contract are **acceptable**; see “Architectural limitations” in [agent-chat.md](./agent-chat.md).

Backup/restore and multi-tenant storage considerations are discussed in [PRODUCTIZATION.md](../PRODUCTIZATION.md) (e.g. wiki storage §2).

---

*Back: [README.md](./README.md)*
