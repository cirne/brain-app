# DigitalOcean CLI access (`doctl`)

Use this when provisioning or operating **BrainTunnel** (or other) infrastructure on DigitalOcean: droplets, volumes, firewalls, Container Registry, DNS, etc. Hosted deployment context lives in [OPP-041](opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md) (stub; full runbook: [archive](opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md)).

## Install

Install [`doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/) and confirm:

```sh
doctl version
```

## Teams, tokens, and projects

| Concept | What it is |
| -------- | ----------- |
| **Team** | Billing and resource boundary in DigitalOcean. Your **API token is created for exactly one team**—the one selected in the control panel when you generate the token. There is **no** separate “switch team” flag in `doctl`; the token *is* the team scope. |
| **API token** | Secret used by `doctl` (and the API). [Create and manage tokens](https://cloud.digitalocean.com/account/api/tokens) under **API** → **Tokens**. |
| **Project** | Dashboard **grouping** only (organizing droplets, registries, etc.). It does **not** authenticate the CLI. Use **`--project-id`** on relevant `doctl` commands if resources must be created under a specific project. |

If `doctl account get` shows the wrong team, you are using a token that was issued under another team—generate a new token with the correct team active in the UI.

## Create a token in the control panel

1. Open **[API → Tokens](https://cloud.digitalocean.com/account/api/tokens)**.
2. Use the **team switcher** and select the team that should own this token (e.g. **BrainTunnel**).
3. **Generate New Token** → name it (e.g. `doctl-laptop`), set expiration and **scopes** (full access vs read/write per product).
4. Copy the token **once**; store it in a password manager or in local `.env` as `DO_TOKEN` (never commit real tokens).

## `doctl` does not read `.env`

The app’s `.env` is for the Braintunnel server; **`doctl` does not load it**. Either:

- **Export** before running `doctl`: `set -a && source .env && set +a`, or
- Pass **`-t` / `--access-token`** on each invocation, e.g. `doctl -t "$DO_TOKEN" account get`.

## Named contexts (multiple teams on one machine)

`doctl` can store several tokens under **named contexts** so you do not overwrite one team when adding another. Named tokens live in **`auth-contexts`** inside `doctl`’s config file; the **`default`** context uses the top-level **`access-token`** field.

**Initialize a BrainTunnel context** (token from that team), in a **normal terminal** (TTY) so `doctl` can accept the token:

```sh
set -a && source .env && set +a   # optional: if the token is in .env
doctl auth init --context braintunnel
# paste DO_TOKEN when prompted
```

Passing **`-t`** together with **`--context`** often fails in **non-interactive** environments with `Unable to read DigitalOcean access token: unknown terminal` (see [doctl#1176](https://github.com/digitalocean/doctl/issues/1176)). Workarounds:

1. Run **`doctl auth init --context braintunnel`** from **Terminal.app** / **iTerm** and paste the token, or  
2. Merge the token into config yourself: under **`auth-contexts`**, set **`braintunnel`** to the token string (YAML map). Back up `~/Library/Application Support/doctl/config.yaml` first. Afterward, **`doctl auth list`** should list **`braintunnel`**.

**List contexts:**

```sh
doctl auth list
```

**Make BrainTunnel the default** for bare `doctl` in this user account:

```sh
doctl auth switch --context braintunnel
```

**Or** keep another team on `default` and pass **`--context braintunnel`** only when needed.

### Repo helper

**`./scripts/doctl-brain.sh`** runs `doctl --context braintunnel` so scripts and muscle memory stay on BrainTunnel without touching `default`:

```sh
./scripts/doctl-brain.sh account get
./scripts/doctl-brain.sh registry login
```

Create the `braintunnel` context first (interactive **`auth init`** or **`auth-contexts`** merge above); otherwise **`./scripts/doctl-brain.sh`** will fail until that context has a token.

## Verify

```sh
doctl account get
# or, without switching default:
doctl -t "$DO_TOKEN" account get
# or:
./scripts/doctl-brain.sh account get
```

The **Team** column should match the team you intended.

## Container Registry

If you use **DigitalOcean Container Registry**:

```sh
./scripts/doctl-brain.sh registry login
# or: doctl registry login   # when default context is already BrainTunnel
```

Then push/pull images to `registry.digitalocean.com/...` as usual.

### Publish from this repo (linux/amd64)

After login, build and push the app image (ripmail prebuild + `docker buildx --push`). The destination is fixed at **`registry.digitalocean.com/braintunnel/brain-app`** (`scripts/docker-deploy-do.sh`). The default target is **`linux/amd64`** (typical DigitalOcean droplets). For ARM droplets, set **`DOCKER_PUBLISH_PLATFORM=linux/arm64`** when deploying.

```sh
npm run docker:deploy
```

Tags: **`registry.digitalocean.com/braintunnel/brain-app:deploy-YYYYMMDD-HHMMSSutc`** (UTC) and **`:latest`** by default. Override the tag string with **`DOCKER_IMAGE_TAG`**; set **`DOCKER_PUBLISH_LATEST=0`** to skip the `:latest` tag.

For a local arm64 image load (no registry), use **`npm run docker:build:arm64`** (`brain-app:arm64-local`). Optional **`DOCKER_*`** overrides are documented in `.env.example`.

### Droplet: install Docker, log in to the registry, run the latest image

On a fresh **Ubuntu** droplet (use an **amd64** droplet type to match the default published image, or publish with **`DOCKER_PUBLISH_PLATFORM=linux/arm64`** for an ARM droplet):

1. **Install Docker Engine and the Compose plugin** (official packages recommended on Ubuntu):

   ```sh
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl
   sudo install -m 0755 -d /etc/apt/keyrings
   sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   sudo chmod a+r /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo usermod -aG docker "$USER"
   ```

   Sign out and back in (or `newgrp docker`) so **`docker`** works without `sudo`.

   **If `docker compose` says `unknown command`:** you have **`docker`** but not the **Compose V2 plugin**. Install it from the same Docker apt repo (after the repo is configured as above):

   ```sh
   sudo apt-get install -y docker-compose-plugin
   docker compose version
   ```

   Until that works, **`docker compose`** will not exist—this is normal when only `docker-ce`/`docker.io` was installed without the plugin. Avoid relying on the legacy hyphenated **`docker-compose`** binary unless you intentionally install it; the plugin matches the docs above.

2. **Put `doctl` on the droplet** (or copy a read/write API token and use Docker’s login below). Example with the [doctl install](https://docs.digitalocean.com/reference/doctl/how-to/install/) method you prefer, then:

   ```sh
   doctl auth init -t "$DO_TOKEN"   # one-time; or use your named context from the doc above
   doctl registry login
   ```

   If you do not install `doctl`, you can still authenticate Docker to the registry using a token (see [DO: Authenticate with a token](https://docs.digitalocean.com/products/container-registry/how-to/use-registry-docker-kubernetes/#authenticate-with-a-token)).

3. **Deploy** — you need **`docker-compose.do.yml`** and **`.env`** on the droplet (copy from the repo or clone the repo and `cd` to it). Same directory must contain `.env` (API keys, etc.):

   ```sh
   docker compose -f docker-compose.do.yml pull
   docker compose -f docker-compose.do.yml up -d
   ```

   That pulls **`registry.digitalocean.com/braintunnel/brain-app:latest`** and starts it. Data lives in the **`brain_data`** Docker volume (`BRAIN_DATA_ROOT=/brain-data` inside the container). That volume is **on a fixed path managed by Docker on the host** — **pulling a new image and recreating the container does not delete** wiki, vault, ripmail, or chats (same as any named volume: remove the volume explicitly only if you intend to wipe data).

### Staging: HTTPS public URL

**Current DigitalOcean staging** is **`https://staging.braintunnel.ai`**: TLS terminates **in front of** the Braintunnel container (reverse proxy, load balancer, or tunnel). The container still listens on **HTTP :4000** on the Docker network; browsers never hit plain **:4000** on the public Internet when the edge is configured correctly.

**New host or environment:** Set **`PUBLIC_WEB_ORIGIN`** to the canonical **`https://…`** origin, register that redirect URI in **Google Cloud Console**, and terminate TLS at the edge — see [OPP-041 — HTTPS / edge checklist](opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md#reference-https--edge-checklist-new-hosts) (full epic; the [stub](opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md) points here).

4. **Set `PUBLIC_WEB_ORIGIN`** in `.env` to the URL users open in the browser (e.g. **`https://staging.braintunnel.ai`** or **`https://your-domain.com`**). The origin must match what users type (OAuth and cookies depend on it). Localhost defaults do not match production OAuth redirects.

5. **Firewall:** allow the published port (default host **`4000`** via `BRAIN_DOCKER_PORT`, or **`80`/`443`** if you put Caddy/nginx in front):

   ```sh
   sudo ufw allow OpenSSH
   sudo ufw allow 4000/tcp   # or 80,443/tcp as needed
   sudo ufw enable
   ```

**Updates:** After you publish a new `:latest`, on the droplet run **`docker compose -f docker-compose.do.yml pull`** then **`docker compose -f docker-compose.do.yml up -d`** (Compose recreates the container when the image digest changes).

## Optional: `DO_TOKEN` in `.env`

You may add `DO_TOKEN=` to your **local** `.env` for convenience (see `.env.example`). It is **not** used by `npm run dev` or the Braintunnel server—only for your shell or for passing into `doctl -t "$DO_TOKEN"`.

## See also

- [OPP-041 — Docker / DigitalOcean epic (full spec)](opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) · [stub](opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md)
- [DigitalOcean: Authenticating with `doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/#authenticate-doctl)
