# Braintunnel — deployment (early staging)

**Status:** very early. This page describes **how we deploy today**, not a target architecture. For product packaging (desktop app) vs hosted Linux, see [ARCHITECTURE.md](./ARCHITECTURE.md) and [architecture/deployment-models.md](architecture/deployment-models.md).

**Last verified (DigitalOcean API):** 2026-04-26 via `doctl` (team **Braintunnel**). IDs below are for operators running [`doctl`](https://docs.digitalocean.com/reference/doctl/reference/) and the [repo helper](../scripts/doctl-brain.sh) — see [digitalocean.md](./digitalocean.md) for token contexts.

## Domain and DNS

- **`braintunnel.io`** is purchased and **managed in Cloudflare** (registrar / DNS).
- **Public web origin (staging):** `https://staging.braintunnel.ai` — **TLS terminates at Cloudflare** (and/or other edge config there). Traffic reaches DigitalOcean as **HTTP** to the **regional load balancer** (see below), which forwards to the app container on **port 4000**. In-repo reference: [`docker-compose.do.yml`](../docker-compose.do.yml) (`PUBLIC_WEB_ORIGIN`).

## Scale and audience

- **Single staging instance** only, intended to support on the order of **~15 signups** (informal cap for early testing).
- **Google sign-in (OAuth):** the Google Cloud project is **not** through full production app verification yet. In **testing** mode, Google caps usage at about **~100 total users** unless each address is on the [test user list](https://console.cloud.google.com/auth/audience?project=zmail-492422) (see below). Lifting that limit requires **Google OAuth app verification** — milestone plan: [OPP-043: Google OAuth app verification](opportunities/OPP-043-google-oauth-app-verification-milestones.md); background: [OPP-022](opportunities/OPP-022-google-oauth-app-verification.md).

## Google Cloud — test users

- Manage who may sign in under the current cap: **Google Cloud Console → Audience** (OAuth consent test users) for project **`zmail-492422`**:  
  [https://console.cloud.google.com/auth/audience?project=zmail-492422](https://console.cloud.google.com/auth/audience?project=zmail-492422)

## Staging project (DigitalOcean)

| Field | Value |
|--------|--------|
| **Project name** | Braintunnel Staging |
| **Project ID** | `f11c9b9d-9b7b-49d3-aa31-b1d0a485f5c5` |
| **Purpose (dashboard)** | Web Application, Staging |

**Dashboard resources in this project** (verified) include: Droplet `566281071`, load balancer, block volume, DNS **`braintunnel.ai`**, and a volume snapshot.

**`doctl`:**

```sh
./scripts/doctl-brain.sh projects list
./scripts/doctl-brain.sh projects resources list f11c9b9d-9b7b-49d3-aa31-b1d0a485f5c5
```

**URNs (API / support):** e.g. `do:droplet:566281071`, `do:loadbalancer:b8f2693c-18f8-4294-90d4-b170d24b07a9`, `do:volume:dbe73672-3dc0-11f1-ae57-0a58ac1445f1`.

## Staging host (DigitalOcean)

| Item | Value |
|------|--------|
| **Droplet ID** | `566281071` |
| **Name** | `braintunnel-staging` |
| **Size** | `g-16vcpu-64gb` (16 vCPU, 64 GiB RAM, 200 GiB local disk) |
| **Region** | `nyc1` (New York 1) |
| **Image** | Ubuntu 24.04 (LTS) x64 |
| **Public IPv4** | `157.230.223.25` (SSH, **direct to droplet** — not the public app entry) |
| **Private IPv4 (VPC)** | `10.116.0.2` |
| **VPC UUID** | `6bf4deb4-0b9a-42b8-bac7-bce16bc4ddc0` |
| **OS login** | user **`brain`**; **SSH key only** (Lew’s private key; not shared) |

**`doctl`:**

```sh
./scripts/doctl-brain.sh compute droplet get 566281071
# ssh brain@157.230.223.25
```

### Block storage (`BRAIN_HOME` / `BRAIN_DATA_ROOT`)

Durable data is on a **separate block volume** (not the droplet’s local disk), mounted on the host and bound into the container (see [`docker-compose.do.yml`](../docker-compose.do.yml) — e.g. host `/brain-data` → `/brain-data` in container).

| Field | Value |
|--------|--------|
| **Volume ID** | `dbe73672-3dc0-11f1-ae57-0a58ac1445f1` |
| **Name** | `braintunnel-staging-storage` |
| **Size** | 100 GiB |
| **Region** | `nyc1` |
| **Filesystem** | ext4 |
| **Attached to droplet** | `566281071` |

```sh
./scripts/doctl-brain.sh compute volume get dbe73672-3dc0-11f1-ae57-0a58ac1445f1
```

### Load balancer (HTTP to the app)

The DigitalOcean load balancer speaks **HTTP** to backends on **port 4000** (not TLS on the LB for this setup; **HTTPS for browsers is at Cloudflare** in front of this or its target IP).

| Field | Value |
|--------|--------|
| **Load balancer ID** | `b8f2693c-18f8-4294-90d4-b170d24b07a9` |
| **Name** | `braintunnel-staging-lb` |
| **Public IPv4** | `137.184.243.154` (typical **origin** target from Cloudflare) |
| **Public IPv6** | `2604:a880:400:d1:0:4:4bcc:2001` |
| **Size** | `lb-small` |
| **Region** | `nyc1` |
| **Forwarding** | `http:80` → backend `http:4000` on droplet `566281071` |
| **Health check** | HTTP, port `4000`, path `/` |

```sh
./scripts/doctl-brain.sh compute load-balancer get b8f2693c-18f8-4294-90d4-b170d24b07a9
```

### Cloud firewall (droplet)

DigitalOcean **Cloud Firewall** `braintunnel-staging-fw` — **not** UFW on the host (though UFW may also exist; this is the **network** policy applied at the platform layer).

| Field | Value |
|--------|--------|
| **Firewall ID** | `bf9eaa6b-bd05-49bf-b190-33e6130302c9` |
| **Name** | `braintunnel-staging-fw` |
| **Status** | `succeeded` |
| **Scope** | **Tagless** — attached directly to droplet `566281071` (not via a tag) |
| **Created** | `2026-04-21T20:10:39Z` |

**Inbound rules** (only these reach the droplet; everything else is dropped at the DO edge for this resource):

| # | Protocol | Port(s) | Source | Purpose |
|---|----------|---------|--------|---------|
| 1 | TCP | `22` | `0.0.0.0/0` and `::/0` | **SSH** from the public Internet (IPv4 + IPv6) |
| 2 | TCP | `4000` | Load balancer UID `b8f2693c-18f8-4294-90d4-b170d24b07a9` only | **App** — HTTP to the container; [DO resolves this to the LB’s addresses](https://docs.digitalocean.com/products/networking/firewalls/) so only that load balancer can connect to :4000 |

So **:4000 is not** open to the general internet — it is restricted to the **one** load balancer in front of staging. Browsers and curl hit **Cloudflare / the LB IP** on :80, which forwards to the droplet on :4000.

**Outbound rules** (permissive — typical for a server that pulls images, calls APIs, and does DNS):

| # | Protocol | Port(s) | Destination |
|---|----------|---------|-------------|
| 1 | ICMP | all (`0`) | `0.0.0.0/0`, `::/0` |
| 2 | TCP | all (`0` = all ports) | `0.0.0.0/0`, `::/0` |
| 3 | UDP | all (`0`) | `0.0.0.0/0`, `::/0` |

**Implications:** Egress is effectively **unrestricted** (updates, `docker pull`, OpenAI, Google OAuth, etc. do not need extra rules). Inbound **SSH is open to the world** on port 22; if you need stricter access, replace the `0.0.0.0/0` / `::/0` sources with your **own IP** or a **tailscale / bastion** CIDR in the [control panel](https://cloud.digitalocean.com/networking/firewalls) or `doctl compute firewall replace …`.

**`doctl` (source of truth for rules):**

```sh
./scripts/doctl-brain.sh compute firewall get bf9eaa6b-bd05-49bf-b190-33e6130302c9
./scripts/doctl-brain.sh compute firewall get bf9eaa6b-bd05-49bf-b190-33e6130302c9 -o json
```

## Container Registry

| Field | Value |
|--------|--------|
| **Registry name** | `braintunnel` |
| **Endpoint** | `registry.digitalocean.com/braintunnel` |
| **Registry region** | `nyc3` (registry metadata; droplet is `nyc1`) |
| **Repository** | `brain-app` (tags e.g. `latest`, version tags from publish) |

```sh
./scripts/doctl-brain.sh registry get
./scripts/doctl-brain.sh registry repository list-v2
# If you have multiple registries: add --registry braintunnel
# Full image: registry.digitalocean.com/braintunnel/brain-app:latest
```

## Runtime on the droplet

- **Compose:** `docker compose` is used with a compose file in the **deployment directory on the host** (same layout as the repo’s [`docker-compose.do.yml`](../docker-compose.do.yml): image from registry, `env_file`, port **4000**).
- **Secrets:** a **`.env`** file in that host directory holds secrets (e.g. OpenAI API key, `BRAIN_MASTER_KEY` / related keys as configured). This file is **not** in git; see [.env.example](../.env.example) for variable names.
- **Watchtower:** runs on the droplet and **pulls** new images from the registry and **restarts** the stack when a new image is published — typically **~60 seconds** of downtime per rollout.

## Build and publish

- **Image:** `registry.digitalocean.com/braintunnel/brain-app` (see [digitalocean.md](./digitalocean.md) and the archived [OPP-041](opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) epic).
- **Publish from a developer machine:** build and push to DigitalOcean Container Registry with:

  ```sh
  npm run docker:publish
  ```

  (Uses `scripts/docker-publish-do.sh`; run from repo root with correct Node per `.nvmrc` — see [AGENTS.md](../AGENTS.md).)

- After push, **Watchtower** on the droplet applies the new image (see above).

## Related docs

- [digitalocean.md](./digitalocean.md) — `doctl`, registry login, team context, `./scripts/doctl-brain.sh`
- [google-oauth.md](./google-oauth.md) — redirect URIs, console setup
- [architecture/configuration.md](architecture/configuration.md) — environment variables
