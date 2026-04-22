# Brain (Hono + Svelte) + ripmail — Linux server image. See docs/opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md
#
# ripmail is **not** compiled in this file. Run `npm run docker:ripmail:build` first (host cargo on
# Linux, or a one-off rust:bookworm container with cached Cargo volumes on macOS).
# syntax=docker/dockerfile:1

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
  && apt-get install -y --no-install-recommends ca-certificates libssl3 tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=4000
ENV NEW_RELIC_NO_CONFIG_FILE=true
ENV NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=true
ENV NEW_RELIC_LOG=stdout
ENV NEW_RELIC_AI_MONITORING_ENABLED=true
ENV NEW_RELIC_CUSTOM_INSIGHTS_EVENTS_MAX_SAMPLES_STORED=100k
ENV NEW_RELIC_SPAN_EVENTS_MAX_SAMPLES_STORED=10k
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package.json ./package.json
COPY .docker/linux-ripmail/ripmail /usr/local/bin/ripmail
RUN chmod +x /usr/local/bin/ripmail
ENV RIPMAIL_BIN=/usr/local/bin/ripmail
EXPOSE 4000
# Reap zombie ripmail children if Node misses a wait (belt-and-suspenders with in-process reaping).
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "dist/server/index.js"]
