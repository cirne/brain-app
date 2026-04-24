# Pi agent stack (Mario Zechner packages)

**Purpose:** High-level reference for `**@mariozechner/pi-agent-core`**, `**@mariozechner/pi-ai`**, and `**@mariozechner/pi-coding-agent**` as used in Braintunnel. For chat wiring and persistence, see [agent-chat.md](./agent-chat.md).

**Authoritative package docs:** `node_modules/@mariozechner/pi-agent-core/README.md` (constructor options, events, steering, tools).

## How the pieces fit


| Package               | Role in brain-app                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**pi-agent-core`**   | Stateful `Agent`: transcript, tool loop, streaming events (`turn_start` / `turn_end` / `agent_end`, etc.).                                                                |
| `**pi-ai`**           | `getModel(provider, modelId)`, streaming, `**usage`** on each assistant completion (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost` where supported). |
| `**pi-coding-agent**` | `convertToLlm` and wiki-scoped tools (`read`, `edit`, `write`, `grep`, `find`) composed in `[src/server/agent/tools.ts](../../src/server/agent/tools.ts)`.                |


Session construction: `[src/server/agent/agentFactory.ts](../../src/server/agent/agentFactory.ts)`, `[src/server/agent/assistantAgent.ts](../../src/server/agent/assistantAgent.ts)`. SSE bridge: `[src/server/lib/streamAgentSse.ts](../../src/server/lib/streamAgentSse.ts)`.

## `Agent` constructor options (summary)

These are the main knobs from `**AgentOptions**` (see pi-agent-core README for full typings and examples).


| Option                                 | Notes                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `**initialState**`                     | `systemPrompt`, `**model**`, `**thinkingLevel**` (`off` … `xhigh`), `**tools**`, `**messages**`.       |
| `**convertToLlm**`                     | Map `AgentMessage[]` → provider messages; required if you add custom message roles.                    |
| `**transformContext**`                 | Run **before** `convertToLlm` — pruning, summarization, injected context (major lever for token cost). |
| `**streamFn`**                         | Custom stream implementation (e.g. proxies).                                                           |
| `**onPayload`**                        | Inspect raw stream payloads (pi-ai stream options).                                                    |
| `**beforeToolCall` / `afterToolCall`** | Block tools or reshape results after execution.                                                        |
| `**steeringMode` / `followUpMode**`    | `"one-at-a-time"` (default) or `"all"` for `steer()` / `followUp()` queues.                            |
| `**sessionId**`                        | Forwarded for cache-aware providers.                                                                   |
| `**thinkingBudgets**`                  | Per-level token budgets for thinking-capable models.                                                   |
| `**transport**`                        | Preferred transport (pi-ai).                                                                           |
| `**maxRetryDelayMs**`                  | Cap provider retry backoff.                                                                            |
| `**toolExecution**`                    | `**parallel**` (default) vs `**sequential**` for multiple tool calls in one assistant message.         |
| `**getApiKey**`                        | Dynamic API key resolution.                                                                            |


## Runtime API (summary)

- `**prompt` / `continue**` — start or resume the loop; at most one active run (use `**waitForIdle**`, `**steer**`, `**followUp**`, or an app-level queue — see [BUG-006](../bugs/archive/BUG-006-agent-concurrent-prompt.md)).
- `**subscribe**` — UI and persistence hooks; listeners run in order and can await work on `**agent_end**`.
- `**abort**`, `**waitForIdle**`, `**reset**` — lifecycle.
- `**agent.state**` — mutate `model`, `systemPrompt`, `thinkingLevel`, `tools`, `messages` (array copy semantics per README).

## Usage metering and economics

**Token and cost visibility** are not defined by Pi alone: they come from **pi-ai** fields on assistant messages after each completion. The agent loop may perform **multiple** completions per user-visible reply (tool rounds); aggregate over the whole `**prompt()`** run.

Implementation plan: **[OPP-043: LLM usage and token metering](../opportunities/OPP-043-llm-usage-token-metering.md)** — hooks (`turn_end` / `agent_end`), persistence under `brainHome()`, and background agents.

**Observability (New Relic + local export):** **[OPP-046: LLM telemetry, trace-style correlation, tool result footprint, usage CLI](../opportunities/OPP-046-llm-telemetry-traces-and-usage-cli.md)** — correlated custom events, approximate tool-output size for bottleneck analysis, and a CLI over local JSON.

---

*See also: [agent-chat.md](./agent-chat.md) · [configuration.md](./configuration.md) · [wiki-read-vs-read-email.md*](./wiki-read-vs-read-email.md)