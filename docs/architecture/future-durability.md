# Future: consolidated durable app state (SQLite)

**Status:** Direction only — **not implemented** as the primary store today.

Chat history is **JSON files** under `$BRAIN_HOME/chats`. A future consolidation might use **one SQLite file** per deployment for settings, chat history, or other brain-app–owned state. That database would be **separate** from:

- Ripmail’s SQLite under `RIPMAIL_HOME`
- Wiki markdown files under `$BRAIN_HOME/wiki`

Backup/restore and multi-tenant storage considerations are discussed in [PRODUCTIZATION.md](../PRODUCTIZATION.md) (e.g. wiki storage §2).

---

*Back: [README.md](./README.md)*
