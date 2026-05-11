# Agent instructions

Project context and developer conventions are in **[AGENTS.md](./AGENTS.md)**. That file is the single source of truth for assistants (including Claude Code and Cursor), including the agent behavior guidelines for clarity, simplicity, minimal diffs, and verification.

## Cloud agents (Cursor Cloud)

If you are running in a **cloud environment without Rust/Cargo**, use **[CLOUD-AGENTS.md](./CLOUD-AGENTS.md)** for fast setup. It covers the web app (Hono + Svelte) without desktop-native tooling.