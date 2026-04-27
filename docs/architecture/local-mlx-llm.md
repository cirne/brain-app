# Local MLX LLM (Apple Silicon)

Braintunnel can drive the chat agent against **Qwen 3.6 27B** (and the same wiring pattern for other MLX Community weights) using **`mlx-lm`**’s built-in OpenAI-compatible HTTP server. This is a **Brain-only** provider (`mlx-local`): it is **not** a `KnownProvider` in `@mariozechner/pi-ai`, but the app builds a `Model` row and resolves it via [`resolveModel()`](../../src/server/lib/llm/resolveModel.ts) (see [pi-agent-stack.md](./pi-agent-stack.md)).

**Scope:** macOS **Apple Silicon**, local process, no cloud LLM API key for chat. **TTS / STT / other features** that still call OpenAI or other hosts need their own keys if you use them.

---

## 1. Install and run the MLX server

First-time tooling (see **mlx-lm** / Apple MLX docs for the latest install path):

```sh
brew install uv
uv tool install mlx-lm
```

Start the server on **`11444`** (Ollama’s default is `11434`; using a different port avoids collisions):

```sh
mlx_lm.server --model mlx-community/Qwen3.6-27B-4bit --port 11444
```

The weights are fetched from Hugging Face on first use.

| Model id | Weights (approx.) | Min RAM (guidance) |
|----------|-------------------|--------------------|
| `mlx-community/Qwen3.6-27B-4bit` | ~17 GB | ~36 GB |
| `mlx-community/Qwen3.6-27B-8bit` | ~28 GB | ~64 GB |

**Background** (optional):

```sh
( mlx_lm.server --model mlx-community/Qwen3.6-27B-4bit --port 11444 > /tmp/mlx-server.log 2>&1 & echo $! > /tmp/mlx-server.pid )
```

**Stop:**

```sh
kill $(cat /tmp/mlx-server.pid)
```

**Sanity check:**

```sh
curl http://localhost:11444/v1/models
```

You should see JSON listing `mlx-community/Qwen3.6-27B-4bit` (or whichever `--model` you passed).

---

## 2. Braintunnel / brain-app environment

Set these in the repo-root **`.env`** (see [`.env.example`](../../.env.example)) and **restart** the Node server (`npm run dev` or the bundled app) so `process.env` picks them up.

**Required for MLX chat:**

```bash
LLM_PROVIDER=mlx-local
LLM_MODEL=mlx-community/Qwen3.6-27B-4bit
```

**Optional:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `MLX_LOCAL_BASE_URL` | `http://localhost:11444/v1` | OpenAI-compatible base URL if the server listens elsewhere. |
| `MLX_LOCAL_API_KEY` | `local` (if unset) | Sent as the API key; `mlx_lm.server` typically ignores it. |
| `MLX_LOCAL_THINKING` | off | Set to `1`, `true`, or `yes` to enable Qwen **extended thinking** (`chat_template_kwargs.enable_thinking`). **Unset = off** for lower latency (Brain patches every chat-completions payload for `mlx-local`; see [`mlxLocalChatPayload.ts`](../../src/server/lib/llm/mlxLocalChatPayload.ts)). |

**8-bit variant:**

```bash
LLM_MODEL=mlx-community/Qwen3.6-27B-8bit
```

**Cloud keys:** You do **not** need `OPENAI_API_KEY` (or similar) for the **agent** when using `mlx-local`. Other code paths (e.g. TTS, transcribe, hosted evals against OpenAI) may still expect keys—see [configuration.md](./configuration.md).

---

## 3. Relation to the standalone **pi** CLI

If you use the **pi** coding agent on the same machine, you can register the same endpoint in **`~/.pi/agent/models.json`**: `baseUrl` `http://localhost:11444/v1`, `api` `openai-completions`, optional `apiKey` `local`, and `compat.thinkingFormat` `qwen-chat-template` (see upstream pi / MLX Qwen notes). That file affects **pi** only.

Braintunnel does **not** read `models.json`; it uses **`LLM_*` and `MLX_LOCAL_*`** env vars and the catalog in [`mlxLocalModel.ts`](../../src/server/lib/llm/mlxLocalModel.ts).

---

## 4. Evals (JSONL)

JSONL eval CLIs load `.env` **before** applying CLI flags. If `.env` still says `LLM_PROVIDER=openai`, **shell exports alone will not win**—pass explicit flags:

```sh
npx tsx --tsconfig tsconfig.server.json src/server/evals/jsonlSuiteCli.ts \
  --provider mlx-local --model mlx-community/Qwen3.6-27B-4bit --id enron-004-no-hit-xyzzy
```

See [eval/README.md](../../eval/README.md).

---

## 5. Implementation pointers

| Piece | Location |
|-------|----------|
| Model rows + `mlx-local` compat (`qwen-chat-template`) | [`mlxLocalModel.ts`](../../src/server/lib/llm/mlxLocalModel.ts) |
| `getModel` + custom providers | [`resolveModel.ts`](../../src/server/lib/llm/resolveModel.ts) |
| API key default for MLX | [`resolveLlmApiKey`](../../src/server/lib/llm/resolveModel.ts) |
| Thinking on/off for MLX requests | [`mlxLocalChatPayload.ts`](../../src/server/lib/llm/mlxLocalChatPayload.ts), [`llmOnPayloadChain.ts`](../../src/server/lib/llm/llmOnPayloadChain.ts) |
| Curated eval / doc ids | [`supported-llm-models.json`](../../src/server/evals/supported-llm-models.json) (`mlx-local` section) |

---

## 6. Limitations and expectations

- **Tool quality** — Local models may differ from cloud defaults on multi-step tool use; see [pi-agent-stack.md — LLM model ids and tool compatibility](./pi-agent-stack.md#llm-model-ids-and-tool-compatibility).
- **Startup smoke** — `verifyLlmAtStartup()` calls the configured provider; ensure the MLX server is up before starting Brain, or set `LLM_SKIP_STARTUP_SMOKE=true` temporarily.
- **Cost** — Usage reports `cost` as zero for MLX; token counts still accumulate for observability.
