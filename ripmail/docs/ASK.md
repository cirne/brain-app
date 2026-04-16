# Using `ripmail ask` as a Higher-Level Query Interface

**For agents integrating with ripmail** — This document explains how agents can use `ripmail ask` as a high-level abstraction instead of orchestrating ripmail's primitive tools directly.

**Discovering behavior without memorizing flags:** Run **`ripmail`**, **`ripmail --help`**, and **`ripmail <command> --help`**. The CLI embeds **hints** in output (e.g. JSON **`hints`** when results are truncated or a follow-up action is suggested). Prefer those live messages over stale prose. See [skills/ripmail/references/CANONICAL-DOCS.md](../skills/ripmail/references/CANONICAL-DOCS.md) (also shipped under `skills/ripmail/` in the package).

---

## The Problem: Orchestration Overhead

When agents orchestrate ripmail **CLI primitives** (`ripmail search`, `ripmail read`, `ripmail who`, `ripmail thread`, etc.) via subprocess, they must:

1. **Understand each command's flags and JSON shapes** — learn parameters, response shapes, when to use each command
2. **Orchestrate multiple tool calls** — decide search strategy, follow up with reads, combine results
3. **Synthesize answers themselves** — extract information from structured JSON and produce natural language responses
4. **Handle edge cases** — empty results, date parsing, ID normalization, pagination

This creates **high latency** because:
- Each tool call requires a full LLM round-trip (15-25s with powerful models like Opus 4.6)
- Complex queries need 3-4 rounds (search → read → follow-up → synthesize) = ~50-100s total
- The orchestrating agent carries heavy context (50k+ tokens) and complex tool schemas

**Example:** To answer "who is marcio nunes and how do I know him?", an agent must:
1. Run `ripmail who "marcio nunes" --json` → get email address
2. Run `ripmail search` with a from filter → get message list
3. Run `ripmail thread <id>` for relevant threads → get full conversations
4. Synthesize the answer from structured JSON

That's **3-4 LLM rounds** at 15-25s each = **45-100s total**.

---

## The Solution: `ripmail ask`

`ripmail ask` moves all orchestration **inside ripmail** using a fast, specialized pipeline:

```
Agent → ripmail ask "<question>" → synthesized answer (streaming)
```

**Single subprocess call, zero orchestration overhead.**

### How It Works Internally

`ripmail ask` uses a **two-LLM pipeline** optimized for speed:

1. **Nano (GPT-4.1 nano)** — Fast exploration loop (~200-500ms per round)
   - Uses metadata-only tools (headers, snippets, no body content)
   - Explores email index to identify relevant messages/threads
   - Outputs a "fetch plan" (list of message/thread IDs to retrieve)

2. **Context Assembler (pure code)** — Efficient data fetching
   - Fetches full email bodies and attachments based on Nano's plan
   - Applies content caps and formatting
   - Prepares a single, comprehensive context blob

3. **Mini (GPT-4.1 mini)** — Final synthesis (~1-2s)
   - Receives original question + assembled context
   - Makes **no tool calls** — pure synthesis
   - Streams answer to stdout

**Total latency: 4-12s** (vs 45-100s with primitive tools)

---

## Comparison: Primitives vs `ask`

### Example 1: Person Lookup

**Using primitives (agent orchestrates subprocesses):**
```python
# Agent must:
1. ripmail who "marcio nunes" --json  # Round 1: 15-25s
2. ripmail search 'from:marcio@vergemktg.com' --json  # Round 2: 15-25s
3. ripmail thread "<tid1>" --json  # Round 3: 15-25s
4. Synthesize answer from JSON  # Round 4: 15-25s

Total: ~60-100s, 4 LLM rounds
```

**Using `ripmail ask` (single call):**
```bash
ripmail ask "who is marcio nunes and how do I know him?"
# → Streaming answer: "Marcio Nunes is the CEO & Founder of Harmonee AI..."

Total: ~4-12s, 0 agent LLM rounds
```

### Example 2: Spending Summary

**Using primitives:**
```python
# Agent must:
1. ripmail search "apple.com after:30d" --json  # Round 1
2. ripmail search "receipt after:30d" --json  # Round 2
3. ripmail read "<id>" (per message)  # Round 3+
4. Extract amounts, dates, synthesize  # Round 4

Total: ~60-100s, 4 LLM rounds
```

**Using `ripmail ask`:**
```bash
ripmail ask "summarize my spending on apple.com in the last 30 days"
# → Streaming answer with detailed breakdown

Total: ~11-12s, 0 agent LLM rounds
```

---

## When to Use Each Approach

### Use `ripmail ask` when:

✅ **You want a natural language answer** — "who is X?", "summarize my spending", "what emails did I get today?"

✅ **You need fast answers** — prioritize latency over control

✅ **You don't need structured data** — the answer is text, not JSON to parse

✅ **You want ripmail to handle orchestration** — let the specialized pipeline optimize retrieval

✅ **You're building a conversational interface** — user asks questions, agent returns answers

### Use CLI primitives when:

✅ **You need structured data** — you want JSON arrays/objects to process programmatically

✅ **You need fine-grained control** — specific search parameters, pagination, detail levels

✅ **You're building a tool/UI** — you need to display search results, message lists, etc.

✅ **You need incremental exploration** — user clicks through results, drills into threads

✅ **You're debugging or inspecting** — you want to see raw search results, message metadata

---

## Integration Patterns

### Pattern 1: Subprocess Call (CLI)

**Best for:** Agents that can execute shell commands

```python
import subprocess

def ask_ripmail(question: str) -> str:
    """Call ripmail ask and return the answer."""
    result = subprocess.run(
        ["ripmail", "ask", question],
        capture_output=True,
        text=True,
        timeout=30  # Most queries complete in <15s
    )
    if result.returncode != 0:
        raise RuntimeError(f"ripmail ask failed: {result.stderr}")
    return result.stdout.strip()
```

**Usage:**
```python
answer = ask_ripmail("who is marcio nunes and how do I know him?")
# → "Marcio Nunes is the CEO & Founder of Harmonee AI..."
```

### Pattern 2: Hybrid Approach

**Use `ask` for Q&A, CLI primitives for structured data:**

```python
# Fast Q&A
answer = ask_ripmail("what newsletters did I get this week?")

# Structured exploration (if user wants to drill in)
if user_wants_details:
    subprocess.run(["ripmail", "search", "newsletter after:7d", "--json"], ...)
```

---

## Performance Characteristics

### Latency Comparison

| Query Type | Primitives (Opus 4.6) | `ripmail ask` | Improvement |
|------------|----------------------|-------------|-------------|
| Person lookup | ~60-100s (4 rounds) | ~4-12s | **5-10x faster** |
| Spending summary | ~60-100s (4 rounds) | ~11-12s | **5-9x faster** |
| Today's emails | ~45-75s (3 rounds) | ~11-12s | **4-7x faster** |

**Target:** `ripmail ask` achieves **≥50% latency improvement** vs multi-round primitive orchestration with a general-purpose model (e.g., ~50s → ~25s). Current results show **4-10x improvement** over that pattern.

### Cost Comparison

| Approach | Cost per Query | Notes |
|----------|---------------|-------|
| Primitives (Opus 4.6) | ~$0.10-0.20 | 3-4 rounds × $0.03-0.05/round |
| `ripmail ask` (Nano + Mini) | ~$0.003-0.01 | Nano: $0.10/1M tokens, Mini: $0.40/1M tokens |

**Cost savings: ~10-20x** per query.

---

## Debugging and Transparency

`ripmail ask` writes debug logs to `stderr`:

```
[nano round 1] tool calls: 1
[nano] calling search({"query":"apple.com","afterDate":"30d"})
[nano] search returned 15 results
[fetch plan] extracted: messageIds=29, threadIds=29
[context assembler] fetching 20 messages by ID
[context] assembled 46187 chars from 29 messageIds, 29 threadIds
pipelineMs: 11550
```

**To see debug output:**
```bash
ripmail ask "your question" 2>&1 | tee output.log
# stdout = answer
# stderr = debug logs
```

**To suppress debug logs:**
```bash
ripmail ask "your question" 2>/dev/null
```

---

## Limitations and Tradeoffs

### Limitations

- **Requires LLM credentials** — default is OpenAI (`RIPMAIL_OPENAI_API_KEY` or `OPENAI_API_KEY`). Anthropic uses `RIPMAIL_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY`. **Local Ollama** needs no API key: set `llm.provider` to `ollama`, plus `llm.fastModel` / `llm.defaultModel` in `config.json` (see [OPP-046](../opportunities/archive/OPP-046-llm-provider-flexibility.md)); ripmail sends a harmless placeholder for the HTTP client.
- **No structured output** (Phase 1) — returns text, not JSON with sources/metadata
- **No fine-grained control** — can't specify search parameters, detail levels, pagination
- **Less transparent** — internal tool calls are hidden (debug logs help)

### Tradeoffs

- **Speed vs Control** — `ask` prioritizes speed; primitives give control
- **Simplicity vs Flexibility** — `ask` is simpler; primitives are more flexible
- **Cost vs Quality** — `ask` uses cheaper models; primitives can use more powerful models

---

## Future Enhancements

See [OPP-020](../opportunities/archive/OPP-020-answer-engine-local-agent.md) for roadmap:

- **Phase 1 (done):** CLI `ripmail ask` with internal pipeline
- **Phase 2 (open):** Optional non-CLI transport for the same pipeline (e.g. future MCP `ask_email`), structured JSON output, rule-based shortcuts — see [OPP-020](../opportunities/archive/OPP-020-answer-engine-local-agent.md), [OPP-039](../opportunities/OPP-039-mcp-deferred-cli-first.md)
- **Phase 3 (only if needed):** Vector / semantic retrieval — product is FTS-only today ([OPP-019 archived](../opportunities/archive/OPP-019-fts-first-retire-semantic-default.md))

---

## Compose: `draft` + `send` (orthogonal to `ask`)

**`ripmail ask`** answers questions **about** mail; it does not send email. The **core outbound loop** is separate:

1. **`ripmail draft new` / `reply` / `forward`** — create a local draft (`data/drafts/`, Markdown + YAML).
2. **`ripmail draft edit <id> "natural language instruction"`** — LLM revises the draft (same provider/key rules as `ripmail ask`). **`ripmail draft rewrite <id> …`** replaces the body literally (no LLM).
3. **`ripmail send <draft-id>`** — SMTP send-as-user; successful send archives the file under **`data/sent/`**. Use **`--dry-run`** first.

Default output is **JSON**; **`--text`** on draft subcommands prints the same human-readable layout as **`draft view`**. Details: [ARCHITECTURE.md § ADR-024](./ARCHITECTURE.md#adr-024-outbound-email--smtp-send-as-user--local-drafts), [OPP-011 archived](./opportunities/archive/OPP-011-send-email.md), publishable skill **`skills/ripmail/SKILL.md`**.

---

## See Also

- [OPP-020](../opportunities/archive/OPP-020-answer-engine-local-agent.md) — Answer engine architecture, phasing, and design philosophy
- [AGENTS.md](../AGENTS.md) — Development guide and CLI reference
