# Supported LLMs — Responses API thinking metadata

Purpose: Brain-specific facts about **`reasoning`** / thinking on the OpenAI Responses path that **pi-ai does not encode**. The pi-ai catalog marks `reasoning: true`; it does not say whether `reasoning.effort: "none"` is accepted.

Primary module: **`openaiResponsesThinking.ts`** — model ids that require mapping `"none"` → `"low"` (minimum effort) because the API rejects `"none"`.

See **Validation** below when adding models or debugging chat/wiki agents.

---

## Validation (manual smoke)

Automated coverage: **`openAiResponsesPayload.test.ts`**, **`llmOnPayloadChain.test.ts`** exercise the remap **only for allowlisted ids**. There is **no CI call** to the live API for every variant.

Before merging a registry change or new default chat model:

1. **`LLM_MODEL=<id>`** with keys set, **`npm run dev`**, send one chat message that triggers a trivial completion **without** tools (e.g. “Say hi in one word.”).

   **Pass:** streamed reply completes; logs show **no API 4xx** on `responses`.

2. **`thinkingLevel`-off assistant** (`assistantAgent` + `thinkingLevel: "off"`):

   **Pass:** same as (1).

   **If the API rejects `reasoning.effort: none`:** add **`model.id`** to `MODEL_IDS_REJECTING_OPENAI_REASONING_EFFORT_NONE` and re-run (1)-(2).

3. **Forced workaround path:** temporarily set **`LLM_MODEL`** to **`gpt-5-codex`** (or another id in the reject set), repeat (1)-(2).

   **Pass:** request still succeeds; payloads use **`reasoning.effort: "low"`** when thinking is off (see **`patchOpenAiReasoningNoneEffort`**).

4. **Background wiki agent** (`wiki_enrichment` / `wiki_cleanup`): optional — one supervisor lap completes without transport errors using the chosen model.

Record new ids and **evidence** (error body or doc link) when extending the reject list.
