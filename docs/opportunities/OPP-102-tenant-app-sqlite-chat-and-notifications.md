# OPP-102: Tenant app SQLite (moved)

**This opportunity is archived (2026-05).** Per-tenant **`var/brain-tenant.sqlite`** ships **chat** (sessions + messages) and **`notifications`** (including **`mail_notify`** rows mirrored from ripmail after refresh/backfill). Ripmail’s mail index remains a **separate** SQLite under **`ripmail/`** until **[OPP-108](OPP-108-unified-tenant-sqlite.md)** merges it into the tenant app DB.

- **Architecture:** [chat-history-sqlite.md](../architecture/chat-history-sqlite.md)
- **Ship summary + full historical spec:** [archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md](archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)
