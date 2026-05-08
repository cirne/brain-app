# Pi agent stack (Mario Zechner packages)

**Purpose:** High-level reference for `**@mariozechner/pi-agent-core`**, `**@mariozechner/pi-ai`**, and `**@mariozechner/pi-coding-agent**` as used in Braintunnel. For chat wiring and persistence, see [agent-chat.md](./agent-chat.md).

**Authoritative package docs:** `node_modules/@mariozechner/pi-agent-core/README.md` (constructor options, events, steering, tools).

## How the pieces fit


| Package               | Role in brain-app                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**pi-agent-core`**   | Stateful `Agent`: transcript, tool loop, streaming events (`turn_start` / `turn_end` / `agent_end`, etc.).                                                                |
| `**pi-ai`**           | `getModel(provider, modelId)` (built-in registry), streaming, `**usage`** on each assistant completion (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost` where supported). Brain wires env through `resolveModel()` in `[src/server/lib/llm/resolveModel.ts](../../src/server/lib/llm/resolveModel.ts)` (adds `mlx-local`). |
| `**pi-coding-agent`** | `convertToLlm` and wiki-scoped tools (`read`, `edit`, `write`, `grep`, `find`) composed in `[src/server/agent/tools.ts](../../src/server/agent/tools.ts`).                |


## LLM providers (pi-ai)

The server parses **`BRAIN_LLM`** (and optional **`BRAIN_FAST_LLM`**) into `provider` + `modelId`, then resolves via `resolveModel()` (see [configuration.md](./configuration.md)). For pi-ai backends, the provider must be a `**KnownProvider**` string (see `node_modules/@mariozechner/pi-ai/dist/types.d.ts`). **Brain-only:** `**mlx-local**` — Qwen 3.6 on Apple Silicon via `mlx_lm.server` (OpenAI-compatible HTTP); see `.env.example` and `supported-llm-models.json`.

`**KnownProvider` (union as shipped in the current dependency):** `amazon-bedrock`, `anthropic`, `azure-openai-responses`, `cerebras`, `github-copilot`, `google`, `google-antigravity`, `google-gemini-cli`, `google-vertex`, `groq`, `huggingface`, `kimi-coding`, `minimax`, `minimax-cn`, `mistral`, `openai`, `openai-codex`, `openrouter`, `opencode`, `opencode-go`, `vercel-ai-gateway`, `xai`, `zai`.

**We routinely point docs and defaults at these:**


| Provider    | Notes                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `openai`    | Default standard tier when `BRAIN_LLM` is unset (`**gpt-5.4-mini**`; see [configuration.md](./configuration.md)); uses `OPENAI_API_KEY`. |
| `anthropic` | Uses `ANTHROPIC_API_KEY` (or `ANTHROPIC_OAUTH_TOKEN` if using OAuth) — see pi-ai `getEnvApiKey`. |
| `xai`       | xAI (Grok, etc.); uses `XAI_API_KEY`.                                                                                                  |
| `mlx-local` | Local **mlx_lm.server** (default base `http://localhost:11444/v1`); optional `MLX_LOCAL_BASE_URL`, `MLX_LOCAL_API_KEY` (defaults to `local`). **`MLX_LOCAL_THINKING=1`** enables Qwen extended thinking; unset/false = off (default, lower latency). Not a pi-ai `KnownProvider`. |


**Future candidates (Google):** The same `KnownProvider` set includes `google` (Generative AI), `google-vertex`, `google-gemini-cli`, and related entries. We do not yet have project-standard **Google / Gemini** API credentials for the agent (`GEMINI_API_KEY` and related env vars in pi-ai); when they are set, `BRAIN_LLM=google/...` becomes viable alongside the table above.

**Other `KnownProvider` values** (e.g. `openrouter`, `groq`, `mistral`, Bedrock) use the env mappings in pi-ai’s `getEnvApiKey` implementation; some use OAuth or cloud ADC instead of a single API key. Prefer the type definition and `getEnvApiKey` in `node_modules/@mariozechner/pi-ai` for details.

### LLM model ids and tool compatibility

`@mariozechner/pi-ai` keeps a **large** `MODELS` table (per provider) for costs, API routing, and `getModel(provider, id)`. **That is not the same** as “safe for a multi-turn **tool-calling** agent.” The same stack powers the **pi** coding CLI; the pi-mono **coding-agent** README says that for each built-in provider they maintain a list of **tool-capable** models, refreshed each release: [Providers & Models (upstream)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#providers--models).

In this repo, `convertToLlm` from `@mariozechner/pi-coding-agent` only shapes **message content**; it does not reject models. Failure modes you can see in practice:


| Situation                                                                                                 | What happens                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getModel` returns `undefined` (unknown id for that provider)                                       | Startup: `[brain-app] … unknown provider/model … (not in pi-ai registry)` — see `verifyLlmAtStartup` in `[src/server/lib/llm/llmStartupSmoke.ts](../../src/server/lib/llm/llmStartupSmoke.ts)`.                                                                                                                     |
| Id is in `MODELS` but API rejects parameters (e.g. some OpenAI **Responses** / **reasoning** constraints) | Startup smoke or first completion may throw; this repo maps some cases via `patchOpenAiReasoning…` in `[openAiResponsePayload` helpers](../../src/server/lib/openAiResponsesPayload.ts).                                                                                                                    |
| Text-only smoke passes but **tool calls** break                                                           | `[verifyLlmAtStartup](../../src/server/lib/llmStartupSmoke.ts)` uses a **single** `completeSimple` user message — **no tools**. A model can pass that and still be a poor or broken fit for the agent loop. Prefer models Pi treats as **tool-capable** for your provider, not an arbitrary `MODELS` entry. |
| OpenRouter / Vercel AI Gateway, etc.                                                                      | Many routed models; backends differ (tools, message shapes). Default to the **same** model ids the Pi CLI would list with `pi --list-models` (see upstream CLI docs in the [same README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)) once keys are set.                 |


**Evals / `.env`:** Set **`BRAIN_LLM`** to **proven tool/agent** configurations (e.g. **`anthropic/claude-sonnet-4-6`**, **`openai/gpt-5.4`**, **`xai/grok-4-1-fast`**) — see [`src/server/evals/supported-llm-models.json`](../../src/server/evals/supported-llm-models.json). Custom and compat options for edge servers are documented in pi-mono: [docs/models.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md).

Session construction: `[src/server/agent/agentFactory.ts](../../src/server/agent/agentFactory.ts)`, `[src/server/agent/assistantAgent.ts](../../src/server/agent/assistantAgent.ts)`. SSE bridge: `[src/server/lib/streamAgentSse.ts](../../src/server/lib/streamAgentSse.ts)`.

## `Agent` constructor options (summary)

These are the main knobs from `**AgentOptions`** (see pi-agent-core README for full typings and examples).


| Option                                 | Notes                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `**initialState`**                     | `systemPrompt`, `**model**`, `**thinkingLevel**` (`off` … `xhigh`), `**tools**`, `**messages**`.       |
| `**convertToLlm**`                     | Map `AgentMessage[]` → provider messages; required if you add custom message roles.                    |
| `**transformContext**`                 | Run **before** `convertToLlm` — pruning, summarization, injected context (major lever for token cost). |
| `**streamFn`**                         | Custom stream implementation (e.g. proxies).                                                           |
| `**onPayload`**                        | Inspect raw stream payloads (pi-ai stream options).                                                    |
| `**beforeToolCall` / `afterToolCall`** | Block tools or reshape results after execution.                                                        |
| `**steeringMode` / `followUpMode`**    | `"one-at-a-time"` (default) or `"all"` for `steer()` / `followUp()` queues.                            |
| `**sessionId`**                        | Forwarded for cache-aware providers.                                                                   |
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

Implementation plan: **[OPP-072: LLM usage and token metering](../opportunities/OPP-072-llm-usage-token-metering.md)** — hooks (`turn_end` / `agent_end`), persistence under `brainHome()`, and background agents.

**Observability (New Relic + local export):** **[OPP-071: LLM telemetry, trace-style correlation, tool result footprint, usage CLI](../opportunities/OPP-071-llm-telemetry-traces-and-usage-cli.md)** — correlated custom events, approximate tool-output size for bottleneck analysis, and a CLI over local JSON.

---

*See also: [agent-chat.md](./agent-chat.md) · [configuration.md](./configuration.md) · [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md)*