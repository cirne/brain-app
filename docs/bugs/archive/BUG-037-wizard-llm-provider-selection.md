# BUG-037: Wizard and `ripmail setup` do not configure LLM provider or models

**Former ripmail id:** BUG-053 (unified backlog 2026-05-01).

**Status:** **Archived (2026-05-15).** Ripmail wizard not used for Brain onboarding; LLM provider setup is in-app.

**Was:** Open. **Created:** 2026-04-11. **Tags:** wizard, setup, llm, ux, agent-first

**Related:** [OPP-046 archived](../../opportunities/archive/OPP-046-llm-provider-flexibility.md) (multi-provider `llm` in `config.json` + env is implemented; onboarding was explicitly deferred).

---

## Summary

- **Observed:** `ripmail wizard` shared settings and first-mailbox flows still only prompt for an **OpenAI** API key (`prompt_openai_key`, `merge_root_openai_key` in `src/wizard/mod.rs`). There is no step to set `llm.provider`, `fastModel` / `defaultModel`, `baseUrl` (Ollama), or `RIPMAIL_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY`.
- **Expected:** Users who choose Anthropic or local Ollama should be able to complete onboarding without hand-editing `~/.ripmail/config.json` and `.env`. At minimum: provider selection, the right secret(s) per provider, optional model names (with defaults from `resolve_llm`), and optional Ollama base URL.
- **Impact:** Agent-first setup docs point people at the wizard; multi-provider LLM is invisible unless they read AGENTS.md and edit JSON/env manually.

---

## Scope (suggested)

1. `**ripmail wizard`** — extend **shared settings** (and first-run where applicable) with an LLM subsection: provider (`openai` / `anthropic` / `ollama`), conditional prompts for keys, optional `baseUrl` for Ollama, optional `fastModel` / `defaultModel` or “use defaults” for OpenAI/Anthropic.
2. `**ripmail setup`** — non-interactive flags aligned with [OPP-046 archived § Setup / Wizard Integration](../../opportunities/archive/OPP-046-llm-provider-flexibility.md) (e.g. `--llm-provider`, `--anthropic-key`, `--ollama-base-url`, optional model overrides).
3. **Write path** — merge into `config.json` `llm` and `~/.ripmail/.env` using existing `resolve_llm` / validation helpers where possible (same validation as `validate_openai_key` for Anthropic if we add `validate_anthropic_key`).

---

## Acceptance

- New install can select Anthropic or Ollama in the wizard and run `ripmail ask` without manual `config.json` edits.
- Existing behavior for OpenAI-only users remains the default when `llm` is unset or provider is OpenAI.
- Docs: update [AGENTS.md](../../../ripmail/AGENTS.md) wizard/setup bullets when shipped.