# Brain (Hono + Svelte) + ripmail — Linux server image. See docs/opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md
#
# ripmail is **not** compiled in this file. Run `npm run docker:ripmail:build` first (host cargo on
# Linux, or a one-off rust:bookworm container with cached Cargo volumes on macOS).
#
# Enron demo tenant data is **not** baked in. Seed with `npm run brain:seed-enron-demo` or `BRAIN_ENRON_DEMO_USER=kean node scripts/brain/seed-enron-demo-tenant.mjs` (host) or
# `node /app/seed-enron/scripts/brain/seed-enron-demo-tenant.mjs` in-container — see OPP-051.
# syntax=docker/dockerfile:1

# Stage 1: production node_modules only — layer hash is stable across web-app-only changes
# because it only runs npm ci --omit=dev and is keyed purely on package-lock.json.
FROM node:24-bookworm AS prod-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: full dev-dep install + build
FROM node:24-bookworm AS node-builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libssl3 tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=4000
COPY newrelic.cjs ./newrelic.cjs
# node_modules from prod-deps stage: stable registry layer, only changes when package-lock.json changes.
# Must come before dist so it stays cached when only the web app build changes.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=node-builder /app/package.json ./package.json
# dist is the only volatile layer on web-app-only deploys — kept last so it lands on top.
COPY --from=node-builder /app/dist ./dist
# OPP-051: optional Enron demo seed CLI (no corpus in image — run with BRAIN_DATA_ROOT + EVAL_ENRON_TAR).
COPY scripts/eval/enronKeanIngest.mjs /app/seed-enron/scripts/eval/enronKeanIngest.mjs
COPY scripts/eval/evalBrainCommon.mjs /app/seed-enron/scripts/eval/evalBrainCommon.mjs
COPY scripts/eval/ripmailBin.mjs /app/seed-enron/scripts/eval/ripmailBin.mjs
COPY scripts/brain/seed-enron-demo-tenant.mjs /app/seed-enron/scripts/brain/seed-enron-demo-tenant.mjs
COPY eval/fixtures/enron-kean-manifest.json /app/seed-enron/eval/fixtures/enron-kean-manifest.json
COPY eval/fixtures/enron-lay-manifest.json /app/seed-enron/eval/fixtures/enron-lay-manifest.json
COPY eval/fixtures/enron-skilling-manifest.json /app/seed-enron/eval/fixtures/enron-skilling-manifest.json
COPY eval/fixtures/enron-demo-registry.json /app/seed-enron/eval/fixtures/enron-demo-registry.json
COPY .docker/linux-ripmail/ripmail /usr/local/bin/ripmail
RUN chmod +x /usr/local/bin/ripmail
ENV RIPMAIL_BIN=/usr/local/bin/ripmail
EXPOSE 4000
# Reap zombie ripmail children if Node misses a wait (belt-and-suspenders with in-process reaping).
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
# NOTE: NR ESM loader (--import newrelic/esm-loader.mjs) breaks @mariozechner/pi-* imports.
# Without it, pino logs won't auto-forward to NR with APM entity context.
# APM transactions + custom events still work; logs go to container stdout.
CMD ["node", "dist/server/index.js"]
