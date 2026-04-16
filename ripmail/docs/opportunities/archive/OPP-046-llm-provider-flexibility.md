# OPP-046 — LLM Provider Flexibility: Anthropic + Ollama/Localhost

**Status:** Archived — implemented (2026-04-11)  
**Created:** 2026-04-10

**Shipped:** Optional `llm` block in `config.json` with **`fastModel`** and **`defaultModel`** (not per-phase names): investigation uses `fastModel`, synthesis and draft LLM use `defaultModel`. `resolve_llm` / `resolve_llm_with_env`, `build_llm_client`, wired through `ripmail ask` and draft LLM compose (`src/config.rs`, `src/ask/agent.rs`, `src/send/draft_llm.rs`, `src/draft.rs`, `src/cli/commands/assist.rs`).

**Follow-up (not shipped here):** Wizard/setup still only collect an OpenAI key — see [BUG-053](../../bugs/BUG-053-wizard-llm-provider-selection.md).

---

## Problem (historical)

Every LLM call in ripmail — `ripmail ask` (exploration + synthesis) and `ripmail draft edit/rewrite` (compose) — was hardcoded to OpenAI via the `async-openai` crate. The model names (`gpt-4.1-nano`, `gpt-4.1-mini`) and the API key env var (`RIPMAIL_OPENAI_API_KEY`) were effectively fixed. Users who prefer Anthropic models or who run local models via Ollama could not use these features without the OpenAI key.

---

## Goals

1. **Anthropic API key** — allow using Claude models (e.g. `claude-haiku-4-5` for exploration, `claude-sonnet-4-6` for synthesis).
2. **Ollama / localhost** — allow any OpenAI-compatible local model server (Ollama, LM Studio, llama.cpp with OpenAI shim) by overriding the base URL.
3. **Non-destructive** — existing installs with no `llm` section in `config.json` keep working exactly as today (OpenAI default, env-var API key).

---

## Config Shape

Add an optional top-level `llm` block to `~/.ripmail/config.json`. All fields are optional; absence means "keep current defaults".

### Current config (no change)

```json
{
  "mailboxes": [...],
  "sync": { "defaultSince": "30d" }
}
```

### New config — Anthropic example

Ripmail maps **`fastModel`** to the investigation loop and **`defaultModel`** to synthesis and draft LLM steps (see Implementation Strategy).

```json
{
  "mailboxes": [...],
  "sync": { "defaultSince": "30d" },
  "llm": {
    "provider": "anthropic",
    "fastModel": "claude-haiku-4-5-20251001",
    "defaultModel": "claude-sonnet-4-6"
  }
}
```

API key: `RIPMAIL_ANTHROPIC_API_KEY` env var (or `ANTHROPIC_API_KEY` fallback) in `~/.ripmail/.env`.

### New config — Ollama/localhost example

Set at least one of **`fastModel`** / **`defaultModel`**; if only one is set, the other uses the same tag.

```json
{
  "llm": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434/v1",
    "fastModel": "llama3.2:3b",
    "defaultModel": "llama3.1:8b"
  }
}
```

No API key needed for Ollama (empty string is fine; pass `"ollama"` as placeholder).

### New config — OpenAI with custom models (non-destructive extension)

```json
{
  "llm": {
    "provider": "openai",
    "fastModel": "gpt-4o-mini",
    "defaultModel": "gpt-4o"
  }
}
```

---

## Config Struct Changes (`src/config.rs`)

Add to `ConfigJson`:

```rust
pub llm: Option<LlmJson>,
```

New struct:

```rust
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmJson {
    /// "openai" | "anthropic" | "ollama". Default: "openai".
    pub provider: Option<String>,
    /// Base URL override. Required for ollama (e.g. "http://localhost:11434/v1").
    /// For openai/anthropic: leave null to use the default endpoint.
    pub base_url: Option<String>,
    /// Fast / cheaper model (e.g. `ripmail ask` investigation loop with tools).
    /// Default: "gpt-4.1-nano" (openai), "claude-haiku-4-5-20251001" (anthropic).
    pub fast_model: Option<String>,
    /// Default quality model (`ripmail ask` synthesis, draft LLM compose/edit).
    /// Default: "gpt-4.1-mini" (openai), "claude-sonnet-4-6" (anthropic).
    pub default_model: Option<String>,
}
```

And a resolved form used at runtime:

```rust
pub struct ResolvedLlm {
    pub provider: LlmProvider,   // used only for default base_url and model name lookup
    pub base_url: String,        // always set; derived from provider if not in config
    pub fast_model: String,
    pub default_model: String,
    pub api_key: String,
}

pub enum LlmProvider { OpenAi, Anthropic, Ollama }
```

---

## Provider Resolution

`resolve_llm(config: &LlmJson, env: &EnvVars) -> Result<ResolvedLlm, String>`

| Priority | Source |
|---|---|
| 1 | `config.json` `llm.provider` |
| 2 | Env: `RIPMAIL_LLM_PROVIDER` |
| 3 | Default: `"openai"` |

Model defaults per provider (when `fastModel` / `defaultModel` omitted for `openai` / `anthropic`):

| Provider | `fastModel` | `defaultModel` |
|---|---|---|
| `openai` | `gpt-4.1-nano` | `gpt-4.1-mini` |
| `anthropic` | `claude-haiku-4-5-20251001` | `claude-sonnet-4-6` |
| `ollama` | At least one of `fastModel` / `defaultModel` required; the other defaults to the same tag. |

API key resolution:

| Provider | Env var checked (in order) |
|---|---|
| `openai` | `RIPMAIL_OPENAI_API_KEY`, `OPENAI_API_KEY` |
| `anthropic` | `RIPMAIL_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY` |
| `ollama` | `RIPMAIL_OLLAMA_API_KEY` (optional; default `"ollama"`) |

---

## Implementation Strategy

All three providers — OpenAI, Anthropic, and Ollama — are handled via the same `async-openai` code path. No new crate needed.

**Anthropic** exposes an OpenAI-compatible `/v1/chat/completions` endpoint at `https://api.anthropic.com/v1`. The `async-openai` crate's `with_api_base` + `with_api_key` is sufficient. Tool calling works through the same JSON schema structure.

**Ollama** does the same at `http://localhost:11434/v1` (or whichever port the user runs it on).

```rust
fn build_client(resolved: &ResolvedLlm) -> Client<OpenAIConfig> {
    let base = resolved.base_url.as_deref().unwrap_or(match resolved.provider {
        LlmProvider::Anthropic => "https://api.anthropic.com/v1",
        LlmProvider::Ollama    => "http://localhost:11434/v1",
        LlmProvider::OpenAi    => "https://api.openai.com/v1",
    });
    Client::with_config(
        OpenAIConfig::new()
            .with_api_key(&resolved.api_key)
            .with_api_base(base),
    )
}
```

The rest of `src/ask/agent.rs` and `src/send/draft_llm.rs` is unchanged — same request builder, same tool dispatch loop, same streaming path.

---

## Setup / Wizard Integration (deferred)

Tracked as [BUG-053](../../bugs/BUG-053-wizard-llm-provider-selection.md): `ripmail setup` should accept flags such as `--llm-provider` / Anthropic key / Ollama base URL; the wizard should add a shared-settings step for LLM provider and optional models. Users configure `llm` manually today (`config.json` + `.env`).

---

## Non-destructive Guarantee

- If `config.json` has no `llm` key → behavior is **identical** to today (OpenAI, hardcoded model names, `RIPMAIL_OPENAI_API_KEY`).
- Adding `llm: {}` (empty object) → same defaults, no change.
- The `RIPMAIL_OPENAI_API_KEY` env var continues to work without config changes.
- No schema bump required (config.json is JSON, new keys are additive).

---

## `.env` changes (additive)

```
# Existing (unchanged):
RIPMAIL_OPENAI_API_KEY=sk-...

# New (optional, per provider):
RIPMAIL_ANTHROPIC_API_KEY=sk-ant-...
RIPMAIL_OLLAMA_API_KEY=ollama            # optional placeholder
RIPMAIL_LLM_PROVIDER=anthropic           # optional global override
```

---

## Affected files

| File | Change |
|---|---|
| `src/config.rs` | Add `LlmJson`, `ResolvedLlm`, `LlmProvider`, `resolve_llm()` |
| `src/ask/agent.rs` | Consume `ResolvedLlm`; replace hardcoded `OpenAIConfig` construction with `build_client()` |
| `src/send/draft_llm.rs` | Consume `ResolvedLlm`; swap `OpenAIConfig` construction |
| `src/cli/commands/setup.rs` | Add `--llm-provider`, `--anthropic-key`, `--ollama-base-url` flags |
| `src/wizard/mod.rs` | LLM provider step |
| `AGENTS.md` | Document new env vars and config key |
| `docs/ASK.md` | Update "Requires OpenAI API key" limitation note |

---

## Out of scope for v1

- Per-call model override via CLI flag
- Multiple simultaneous providers (e.g. exploration on Ollama, synthesis on Anthropic)
- Embedding / vector search (unrelated; see OPP-019 archived)
