# Archived: OPP-053 — Staging deploy

**Status: Archived (2026-05-11).** Deploy rollout epic closed for tracking.


---

## Original spec (historical)

### OPP-053: Near–zero downtime staging deploy / rollout (hosted Linux)

**Status:** Proposed.

## Summary

**Staging** today ([DEPLOYMENT.md](../../DEPLOYMENT.md)): push `registry.digitalocean.com/braintunnel/brain-app:latest` → **Watchtower** on the droplet pulls and **restarts** the app container — documented as **~60 seconds downtime per rollout**. Operators observe outages long enough to suspect the **DigitalOcean load balancer** (“not seeing something up”), but the underlying issue is broader: **single-replica replace** plus **LB stabilization time**, not a missing “pull aggressively” knob.

This opportunity captures **directions** to bring staging downtime toward **near zero**, aligned with standard production patterns (overlap healthy backends, readiness before traffic, optional blue/green).

## Why downtime happens today

1. **Watchtower replaces one container** — While the old process is stopped and the new image is starting, there may be **no healthy listener** on the app port (**`:4000`** per [DEPLOYMENT.md](../../DEPLOYMENT.md), [docker-compose.do.yml](../../docker-compose.do.yml)).
2. **Load balancers health-check on an interval** — The DO LB marks backends **down** after repeated failures and **up** after repeated successes. That adds **tens of seconds** beyond raw process boot even after Node answers.
3. **Cold start** — Image pull (if layers changed), container create, Node/Hono startup, optional SQLite/migrations — all extend the gap.

**Misconception:** The LB does not “poll the registry” or “recover faster once you’re back”; it only observes **backend TCP/HTTP health**. Tuning intervals/thresholds **shortens tails** after the new process is ready; it does **not** remove the window where **zero** backends pass checks during stop-before-start.

## Direction A — Cheap wins (still not zero)

Shippable without changing the gross deploy model:

- **Fast, shallow `/health` (or equivalent)** — LB probes should succeed as soon as the HTTP stack accepts connections; avoid heavy dependency checks on every probe if that slows readiness.
- **Tune DO LB health checks** — Shorter interval / thresholds **carefully** (avoid flapping from noisy failures).
- **Faster boots** — Lazy-init expensive subsystems after listening; cache image layers on the droplet.

**Outcome:** Shorter outages; **not** elimination while one container is recreated.

## Direction B — Blue/green on a single droplet (overlap two processes)

Run **two** app instances on **different host ports** (e.g. `:4001` / `:4002`) behind a **local reverse proxy** bound to **`:4000`** — today traffic hits `:4000` from the LB ([DEPLOYMENT.md](../../DEPLOYMENT.md)).

Flow:

1. Deploy **inactive** slot (pull image, start container).
2. Wait until **readiness** passes (same criteria you want the LB to use).
3. **Flip** proxy upstream (reload nginx/Caddy/Traefik config) so traffic moves to the new slot.
4. Stop the old container.

This is the “two containers live + switch at the last second” model — **overlap** eliminates the zero-backend window **if** the proxy stays healthy throughout.

**Tradeoffs:** More moving parts on the droplet (proxy container + compose layout); automation script vs Watchtower-only (Watchtower alone does not orchestrate blue/green).

## Direction C — Multiple backends behind the LB (rolling)

Add a **second droplet** or use an orchestrator (**Docker Swarm**, **Kubernetes**, **Nomad**) / managed platform (**DigitalOcean App Platform**, etc.) so the LB always has **≥1 healthy backend** during rolling updates.

**Outcome:** Classical near–zero downtime deploys at the cost of **infra complexity** and often **billing** (second node or managed tier).

## Relationship to other opportunities and docs

- [OPP-052](./OPP-052-newrelic-change-tracking-on-watchtower-rollout.md) — Observability **during** Watchtower rollouts; complements this OPP but does **not** reduce downtime.
- [DEPLOYMENT.md](../../DEPLOYMENT.md) — Current staging topology (Cloudflare → DO LB → droplet `:4000`, firewall, Watchtower).
- [SECURITY.md](../../SECURITY.md) — **P4** (Watchtower + registry): faster/safer rollouts should **not** weaken pull verification policy if we add hooks or alternate deploy paths.

## Acceptance criteria (draft)

Pick a lane before implementation:

- [ ] **Lane chosen** — Direction A only, B (blue/green on one droplet), or C (multi-backend / orchestrator), with explicit tradeoffs documented in [DEPLOYMENT.md](../../DEPLOYMENT.md).
- [ ] **Measured outcome** — Define acceptable **max observed outage** during a rollout (e.g. &lt;5s vs “browser timeouts”) and validate with LB access logs + synthetic checks or NR synthetics.
- [ ] **Runbook** — Operator steps or automation idempotently deploy without relying on undocumented SSH hacks.

## Out of scope (for this OPP)

- Desktop **Braintunnel.app** updates ([OPP-029](./OPP-029-auto-update.md)).
- Replacing staging infrastructure wholesale unless Direction C explicitly selects a platform (that becomes **in scope** for the chosen lane only).
