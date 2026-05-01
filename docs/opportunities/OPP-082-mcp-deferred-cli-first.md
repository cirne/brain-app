# OPP-082: MCP (stdio) — Deferred; Reintroduction Gated on CLI and Benefit

**Former ripmail id:** OPP-039 (unified backlog 2026-05-01).

**Status:** Open (intentional deferral).

## Summary

ripmail previously shipped an in-tree **MCP** server (`ripmail mcp`, JSON-RPC over stdio) alongside the CLI. **MCP was removed from the tree** so the project can stabilize **CLI flags, JSON shapes, and agent workflows** without maintaining a second surface.

## Product bar for reintroduction

Some agent hosts prefer a **persistent tool session** (e.g. Model Context Protocol over stdio) over **repeated `ripmail` subprocess** calls. ripmail may eventually reintroduce an MCP server, but a second surface duplicates contracts, tests, and docs. That cost is only justified when the CLI story is **stable** and MCP offers a **concrete advantage** over subprocess CLI for real users or integrations.

### Gating — all must be true before shipping in-tree MCP

1. **CLI is “baked.”** The subprocess interface is the source of truth: command set, flags, JSON/text output shapes, draft/send/`ask` workflows, and agent-facing docs ([`AGENTS.md`](../../ripmail/AGENTS.md)) are stable enough that breaking changes are rare and intentional. “Baked” is a maintainer judgment call; it implies confidence that new work will not constantly invalidate a parallel MCP mapping.

2. **Clear benefit over CLI.** The team can state **why** subprocess `ripmail` is insufficient for the target audience, with at least one of:
   - **Measured or credibly argued** wins (e.g. fewer process spawns, lower latency for batched tool use in a long session, ergonomics for a specific host).
   - **Concrete integration** requirements (e.g. a platform that only speaks MCP and cannot shell out cleanly).
   - **User or partner demand** with a defined workflow — not “MCP because it exists.”

If the only story is parity with the CLI, **subprocess remains the default**; MCP stays optional or out of tree.

## Direction

When reintroduced, MCP should wrap the **same** SQLite index and align with the then-current CLI contract (see git history for `src/mcp/mod.rs` and `tests/mcp_stdio.rs` before removal). Reintroduce it as a **thin mapping** to the same behaviors as the CLI (same index, same semantics), not a divergent product surface.

Track answer-pipeline transport separately in [OPP-020 archived](../../ripmail/docs/opportunities/archive/OPP-020-answer-engine-local-agent.md).

## Non-goals

- No parallel “MCP-first” features while MCP is out of tree; agents use **`ripmail` subprocesses**.
- MCP-first features before the CLI contract is settled.
- Maintaining MCP tools that duplicate CLI without a documented benefit or user.

## References

- [ADR-005](../../ripmail/docs/ARCHITECTURE.md#adr-005-agent-interface--native-cli-primary) — agent interface decision
- [BUG-025 archived](../../ripmail/docs/bugs/archive/BUG-025-mcp-cli-parity-deferred.md) — prior parity bug superseded by this deferral
- [OPP-020 archived](../../ripmail/docs/opportunities/archive/OPP-020-answer-engine-local-agent.md) — `ripmail ask` and optional transports
