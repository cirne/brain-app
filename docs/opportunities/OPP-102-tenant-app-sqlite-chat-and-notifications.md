# OPP-102: Tenant app SQLite (moved)

**This opportunity is archived (2026-05).** Per-tenant **`var/brain-tenant.sqlite`** ships **chat** (sessions + messages) and **`notifications`** (including **`mail_notify`** rows mirrored from ripmail after refresh/backfill). Ripmail’s mail index remains a **separate** SQLite under **`ripmail/`** until **[OPP-103](OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md)** unifies schema + ports ripmail to TypeScript.

- **Architecture:** [chat-history-sqlite.md](../architecture/chat-history-sqlite.md)
- **Ship summary + full historical spec:** [archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md](archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)
