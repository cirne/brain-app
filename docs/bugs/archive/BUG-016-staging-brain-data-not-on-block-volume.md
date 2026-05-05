# BUG-016: Staging (braintunnel-staging) not using block storage for `BRAIN_DATA_ROOT`

**Status:** Archived (2026-05-05). Staging volume/compose truthfulness deferred as active bug; ops runbook still applies — re-open if disk layout regresses.

**Severity:** **High (P1)** — tenant data and ripmail home trees grow on the **Droplet root disk**; the **100 GiB** attached volume is underused or **not** the path the app actually uses. Fills the wrong disk, slower replace/rebuild story, and **data is not** on the volume you attach for durability.

**Tags:** `infrastructure`, `digitalocean`, `staging`, `docker`, `braintunnel-staging`

## Summary

**DigitalOcean** `braintunnel-staging` has **block storage** attached (`braintunnel-staging-storage`, mounted at e.g. `/mnt/braintunnel_staging_storage` on the host). Brain’s data root (`BRAIN_DATA_ROOT`, typically `/brain-data` on the host, bind-mounted into the container) should live on that volume so **multi-tenant** `usr_*` trees and per-user `ripmail` data are **durable and sized** against the 100 GiB block device, not the **~60 GiB** root SSD.

**Current problem:** after an attempted migration, **`BRAIN_DATA_ROOT` in the running app did not show the volume path** (e.g. still `BRAIN_DATA_ROOT=/brain-data` on root disk, or deploy/compose on the server was never updated to match). So staging **behaves** “fine” in smoke tests but **is not** actually using the provisioned block storage for application data.

## Symptom

- Startup logs (or `docker inspect` / `compose` env) show **`BRAIN_DATA_ROOT` pointing at a path on `/`** (e.g. `/brain-data` backed by `/dev/vda1`), **not** a subtree of `/mnt/braintunnel_staging_storage/…`.
- Host: `df` / `findmnt` for the path the container uses resolves to the **root** filesystem, not **`sda`** (block volume).
- The block volume may be **nearly empty** while **`/`** usage grows with usage.

## Expected

- **`docker-compose.yml`** (or production override) on the **staging host** sets  
  `BRAIN_DATA_ROOT` to a directory **on the block volume**, e.g.  
  `BRAIN_DATA_ROOT=/mnt/braintunnel_staging_storage/brain-data`  
  **or** the host **bind-mounts** the volume to `/brain-data` in `/etc/fstab` and the app keeps `BRAIN_DATA_ROOT=/brain-data` with that path on disk actually being the volume.
- After deploy, **container logs** show the chosen path; host **`df`/`du`** confirm growth on **`sda`**, not only **`vda`**.

## Evidence / verification (on droplet)

1. **Running config:** `docker compose config` (or `docker inspect <container> | jq '.[0].Config.Env'`) for `BRAIN_DATA_ROOT` and volume mounts.
2. **Where data really is:** from host, `findmnt` / `df` for the **host path** that maps to the container’s `BRAIN_DATA_ROOT` bind mount.
3. **One-time migration** (if data was copied but compose never flipped): as **root** on host, `rsync` from old `/brain-data` to `/mnt/…/brain-data`, fix ownership if needed, update compose, **`docker compose up -d`**, then **remove** old copy after confidence.

**Note (rsync):** on **BSD / macOS** `rsync`, **`-A`** may be invalid; on the **Ubuntu** host use GNU `rsync` or e.g. `rsync -aH --numeric-ids` (and optional ACLs only if `rsync --help` shows them).

## Impact

- **Operational:** risk of **root disk full** under load; **rebuild/resize** of Droplet does not match mental model of “data on attached volume.”
- **Not** a production customer outage if staging-only, but **P1** for **staging truthfulness** and any **rehearsal** of prod disk layout.

## Fix direction

1. **Source of truth:** commit or document the **authoritative** staging `docker-compose` (and env) so deploys are not hand-edited only on the server.
2. **Host:** ensure **one** clear layout: either env points at `/mnt/.../brain-data` **or** fstab **binds** that directory to `/brain-data`.
3. **Verify** after every deploy: automated check (script or runbook) that `BRAIN_DATA_ROOT`’s **mount** is the block device.

## Related

- Provisioning: DigitalOcean droplet + volume (e.g. `doctl compute droplet` / `volume list`).
- In-app: logs at startup that print `BRAIN_DATA_ROOT=` (use as quick health signal).
