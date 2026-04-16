# BUG-025: MCP/CLI Parity — Superseded (MCP Removed from Scope)

**Status:** Closed — superseded 2026-04-05. **Original:** 2026-03-28.

## Resolution

The repository **removed the in-tree MCP stdio server** to focus on baking the **CLI** contract first. The original parity goal (“every CLI capability has an MCP tool”) no longer applies until MCP returns; see [OPP-039](../../opportunities/OPP-039-mcp-deferred-cli-first.md).

**Historical:** The former bug file described gaps between `ripmail mcp` tools and CLI commands (`ask`, `draft edit`, etc.). That implementation lived in `src/mcp/mod.rs` (removed); restore from git history if needed for reference.
