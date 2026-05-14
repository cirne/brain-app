# Archived: OPP-090 — Production naming

**Status: Archived (2026-05-11).** Naming / hostname transition epic closed for tracking.


---

## Original spec (historical)

### OPP-090: Production naming and `my.braintunnel.ai` transition

**Status:** Proposed — operations / product infrastructure transition.

## Summary

The only hosted Braintunnel instance is called **staging** in DigitalOcean, New Relic, docs, scripts, and hostnames, but it is already the production service for a small user cohort. We do **not** currently have a separate staging environment.

This opportunity is to move the service vocabulary and observability from **Braintunnel Staging** to **Braintunnel Production**, while preserving the existing `https://staging.braintunnel.ai` hostname for a long transition window. The long-term user-facing app origin should be:

- Marketing site: `https://braintunnel.ai`
- Product app: `https://my.braintunnel.ai`
- Transitional alias: `https://staging.braintunnel.ai`

## Why this matters

Calling the live service "staging" creates avoidable confusion:

- **Security posture:** [SECURITY.md](../../SECURITY.md) says "early staging" and "Hosted staging", but the documented assets are real user email, OAuth tokens, wiki content, session tokens, and LLM/provider keys.
- **Operations:** [DEPLOYMENT.md](../../DEPLOYMENT.md) describes a single DO project/droplet/volume/LB/firewall named `braintunnel-staging*`, with a no-snapshot policy and production-like access controls.
- **Observability:** [newrelic.md](../../newrelic.md) has only a `Braintunnel Staging` APM entity and explicitly says there is no production APM app yet. Deploy markers in `scripts/docker-deploy-do.sh` target the staging GUID.
- **Product trust:** users should eventually log in at `my.braintunnel.ai`; "staging" reads like a test system even when it contains their real data.

## Current naming surfaces

### Public origins and OAuth

- `docker-compose.do.yml` sets `PUBLIC_WEB_ORIGIN=https://staging.braintunnel.ai`.
- The Google OAuth callback currently needs `https://staging.braintunnel.ai/api/oauth/google/callback`.
- `PUBLIC_WEB_ORIGIN` influences redirect generation and must match the canonical browser origin.
- Cookies are host-only by default. Moving users from `staging.braintunnel.ai` to `my.braintunnel.ai` will likely require re-login, which is acceptable and cleaner than sharing cookies across subdomains.

### Cloudflare / DNS / TLS

- `braintunnel.ai` should remain the marketing site apex.
- `my.braintunnel.ai` should be a proxied Cloudflare DNS record pointing at the same live app edge/load balancer during transition.
- `staging.braintunnel.ai` should remain live as an alias for a reasonable period.
- Decide whether `staging.braintunnel.ai` serves the app directly for the transition or redirects to `my.braintunnel.ai`. A redirect is cleaner once OAuth, cookies, and user comms are ready; serving both directly is lower-risk during initial rollout.

### DigitalOcean resources

The live resources are named as staging labels:

- DO project: `Braintunnel Staging`
- Droplet: `braintunnel-staging`
- Volume: `braintunnel-staging-storage`
- Load balancer: `braintunnel-staging-lb`
- Firewall: `braintunnel-staging-fw`
- Tailscale / operator SSH examples: `ssh brain@braintunnel-staging`

These names are operational labels, not user-facing hostnames. Renaming them is optional and should be separated from the app-origin migration. The safest first phase is to document "this is production despite historical resource names"; later, rename labels only where the operational benefit exceeds churn.

### New Relic

Runtime instrumentation uses `NEW_RELIC_APP_NAME` from the environment; local defaults to `Braintunnel Local Dev`.

Changing the hosted app name from `Braintunnel Staging` to `Braintunnel Production` can create a new APM entity / application identity in New Relic, depending on how the Node agent groups by `app_name`. If we switch names, update:

- `docs/newrelic.md` entity table, appName examples, and deployment marker examples.
- `.cursor/skills/newrelic/SKILL.md` query defaults.
- `scripts/docker-deploy-do.sh` `NR_ENTITY_GUID`, output text, and any application ID examples.
- Dashboards, alerts, saved NRQL, and release/deployment marker runbooks.

Prefer making the NR change intentionally during a quiet deploy window, then record both old and new entity GUIDs in the docs for historical queries.

### Desktop / bridge defaults

The cloud-facing Tauri bridge defaults still point at `https://staging.braintunnel.ai`:

- `desktop/tauri.conf.json`
- `desktop/src/lib.rs`
- `docs/ideas/IDEA-local-bridge-agent.md`

Do not switch distributed/native defaults until `my.braintunnel.ai` is confirmed with OAuth, Cloudflare, and New Relic. Existing builds may continue using the staging origin until a new signed build is shipped.

## Recommended transition plan

### Phase 0 — Rename the mental model in docs

Update docs to say "hosted production (historically named staging)" where that is the truth. Keep exact resource names in runbooks so operators can still find the droplet, firewall, volume, New Relic entity, and Tailscale host.

Initial doc changes:

- [SECURITY.md](../../SECURITY.md): change "early staging" / "Hosted staging" wording to "hosted production, small cohort" while preserving security risks and resource names.
- [DEPLOYMENT.md](../../DEPLOYMENT.md): rename the document concept from "early staging" to "hosted production v0"; add an explicit note that DO labels remain staging for now.
- [architecture/deployment-models.md](../../architecture/deployment-models.md): rename "Staging on DigitalOcean" to "Hosted production v0 on DigitalOcean".
- [newrelic.md](../../newrelic.md): add a note that `Braintunnel Staging` is the current production APM app until the NR cutover.

### Phase 1 — Add `my.braintunnel.ai` as a live alias

Add DNS/TLS for `my.braintunnel.ai` in Cloudflare and point it at the same live origin path as `staging.braintunnel.ai`.

Required checks:

- Cloudflare record is proxied and certificate covers `my.braintunnel.ai`.
- DigitalOcean LB/firewall posture remains unchanged: app traffic still reaches only the LB-to-droplet path documented in [DEPLOYMENT.md](../../DEPLOYMENT.md).
- Register `https://my.braintunnel.ai/api/oauth/google/callback` as an authorized redirect URI in Google Cloud before asking users to use the new host.
- Confirm cookie `Secure` behavior and `X-Forwarded-Proto` are correct on the new host, same as the existing security concern in [SECURITY.md](../../SECURITY.md).

### Phase 2 — Choose canonical origin behavior

For a short overlap, keep both origins working. Once verified:

- Set hosted `PUBLIC_WEB_ORIGIN=https://my.braintunnel.ai`.
- Keep Google OAuth redirect URIs for **both** `staging.braintunnel.ai` and `my.braintunnel.ai` while old links/builds exist.
- Decide whether `staging.braintunnel.ai` redirects to `my.braintunnel.ai` at Cloudflare or remains a direct alias.
- Expect host-only cookies to require re-login when users move to `my.braintunnel.ai`.

Avoid changing `PUBLIC_WEB_ORIGIN` before the OAuth callback and Cloudflare route are verified, because mismatched origin/callback settings create login loops.

### Phase 3 — New Relic production cutover

Set the hosted container env to report as `Braintunnel Production` and update deploy markers to the resulting production entity GUID.

Recommended approach:

1. During one deploy, set `NEW_RELIC_APP_NAME=Braintunnel Production`.
2. Let the app emit traffic and verify the new APM entity appears.
3. Update `scripts/docker-deploy-do.sh` with the new GUID / application ID before the next deploy marker.
4. Update docs and the New Relic skill with default NRQL examples for `Braintunnel Production`.
5. Preserve a "historical staging entity" row for old data queries.

### Phase 4 — Optional infrastructure label cleanup

Only after the app-origin and observability transitions are stable, consider renaming DO dashboard labels from `braintunnel-staging*` to production names.

This is intentionally lower priority because:

- The labels are not user-facing.
- Some examples and operator muscle memory depend on `braintunnel-staging`.
- Hostname/Tailscale rename churn can break SSH shortcuts during an incident.

If done, update [DEPLOYMENT.md](../../DEPLOYMENT.md), [SECURITY.md](../../SECURITY.md), [digitalocean.md](../digitalocean.md), Tailscale/MagicDNS references, and any scripts or local notes that assume `braintunnel-staging`.

## Security considerations

- Do **not** use a full DO snapshot as part of the migration. The no-snapshot policy still applies because snapshots contain plaintext email, OAuth refresh tokens, session tokens, and wiki content.
- Treat this as a production DNS/OAuth/observability migration, not a staging experiment. Roll changes in reversible steps.
- Keep `NODE_ENV=production` and `BRAIN_DATA_ROOT=/brain-data` unchanged.
- Do not widen the DO firewall while adding `my.braintunnel.ai`; DNS/TLS changes should happen at Cloudflare/LB, not by exposing droplet ports.
- Re-check cookie `Secure` behavior for the new host before broad user communication.

## Acceptance criteria

- [ ] Docs consistently describe the live service as **hosted production v0** or equivalent, with historical staging resource names called out explicitly.
- [ ] `my.braintunnel.ai` serves the product app over HTTPS and Google OAuth sign-in succeeds.
- [ ] `staging.braintunnel.ai` remains available as a transitional alias or redirect, with an explicit retention decision.
- [ ] New Relic has a `Braintunnel Production` APM entity or the existing entity is clearly documented as production until cutover.
- [ ] Deploy markers target the correct production New Relic entity after the NR cutover.
- [ ] Operator runbooks preserve enough historical names to find current DO, Cloudflare, Tailscale, and New Relic resources during incidents.

## Non-goals

- Creating a new staging environment. That is a separate follow-on once production naming is honest.
- Migrating user data to a new droplet or volume.
- Renaming every underlying DO/Tailscale resource in the first pass.
- Changing the Google OAuth verification milestone itself; this complements [OPP-043](../OPP-043-google-oauth-app-verification-milestones.md).

## Related

- [SECURITY.md](../../SECURITY.md)
- [DEPLOYMENT.md](../../DEPLOYMENT.md)
- [newrelic.md](../../newrelic.md)
- [digitalocean.md](../digitalocean.md)
- [OPP-041 — Hosted cloud epic](./OPP-041-hosted-cloud-epic-docker-digitalocean.md)
- [OPP-043 — Google OAuth app verification milestones](../OPP-043-google-oauth-app-verification-milestones.md)
- [OPP-052 — New Relic change tracking on Watchtower / container rollouts](./OPP-052-newrelic-change-tracking-on-watchtower-rollout.md)
