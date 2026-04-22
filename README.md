# brain-app

**Product:** **Braintunnel** (this repository is the `brain-app` codebase). Hono + Svelte + ripmail — see [AGENTS.md](./AGENTS.md) for development setup and conventions.

## Docker and subprocess reaping

The production image sets **`tini` as `ENTRYPOINT`** (`Dockerfile`) so PID 1 reaps orphaned or short-lived child processes. For a one-off container without this image, `docker run --init` is an alternative.

The Node server additionally **waits every ripmail child to exit**, applies **timeouts**, **serialized + deduped refresh per `RIPMAIL_HOME`**, and forwards **`RIPMAIL_TIMEOUT`** to ripmail for wall-clock limits inside the CLI.
