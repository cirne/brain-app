# Agent session store: in-memory Map and its limits

**Status:** The current in-memory `Map` design is correct for the desktop use case. It becomes a constraint on the cloud/hosted path. No change needed for desktop-first development; read before scaling horizontally.

---

## Current design

`getOrCreateSession(sessionId)` in `src/server/agent/assistantAgent.ts` keeps live `Agent` instances in a `Map<string, Agent>`. On first access for a `sessionId`, it hydrates the agent from the persisted JSON chat file (up to `HYDRATION_MAX_CHAT_MESSAGES` rows). Subsequent requests for the same session reuse the live agent.

This works well for a single-process, single-user deployment:
- Hot sessions stay warm in memory (fast; no disk round-trip per turn).
- Process restart hydrates from disk; the user loses any in-flight stream but picks up where they left off.
- The agent's internal state (model context, pending queues) is fully consistent because only one process writes to it.

---

## Where it breaks

### Horizontal scaling (multiple Node workers)

Two workers behind a load balancer each hold their own `Map`. A user's request routed to worker B while their session is warm on worker A will cold-hydrate — acceptable but inconsistent. Worse: concurrent requests for the same session from different tabs can land on different workers, causing split-brain agent state.

**Mitigation:** Sticky sessions (route by `session_id` cookie). Works at low scale; adds ops complexity.

**Real fix:** Externalize the session store — e.g. a shared Redis for the live agent state, or accept cold-hydration-on-every-request (simpler, slightly slower). The persisted chat JSON / SQLite remains the source of truth; the `Map` is just a warm-up cache.

### Vault sessions stored in a JSON file

`vaultSessionStore.ts` reads and rewrites `var/vault-sessions.json` on every session validation. Under concurrent requests (multiple open tabs, background SSE connections) this is a read-modify-write race. SQLite with a `sessions` table and proper transaction semantics is the right fix — a natural addition to the app SQLite DB described in [chat-history-sqlite.md](./chat-history-sqlite.md).

### Tenant registry as a JSON file

`tenantRegistry.ts` maintains a `Map<brain_session, tenantUserId>` backed by a JSON file with the same read-modify-write pattern. Under concurrent tenant provisioning (e.g. Google OAuth callbacks racing) this can corrupt the registry. Same fix: SQLite table with `INSERT OR REPLACE`.

---

## Recommended path (when cloud scale requires it)

1. **Near-term (desktop + current staging scale):** No change. The `Map` + file-based vault sessions are fine for a small number of concurrent users.

2. **When horizontal scaling is needed:**
   - Move vault sessions and tenant registry to SQLite (app DB from [chat-history-sqlite.md](./chat-history-sqlite.md)).
   - Add sticky routing by session cookie to the load balancer or Cloudflare Worker layer.
   - Accept cold-hydration as the fallback when a request misses the warm worker.

3. **If stateless workers become a requirement:**
   - Drop the `Map` entirely; hydrate from SQLite on every session start.
   - Accept the cost: slightly higher latency on first turn of each session (one disk read).
   - This is the simplest architecture for horizontal scaling and removes the in-memory coupling.

---

*Back: [README.md](./README.md) · [agent-chat.md](./agent-chat.md)*
