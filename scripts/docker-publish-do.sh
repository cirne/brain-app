#!/usr/bin/env bash
# Build a Linux image (default linux/amd64) with arch-matched ripmail, push to DigitalOcean Container Registry.
#
# DigitalOcean droplets are typically x86_64. Override for ARM hosts: DOCKER_PUBLISH_PLATFORM=linux/arm64
#
# Prerequisites: docker buildx; registry login (e.g. ./scripts/doctl-brain.sh registry login).
#
# Image path is fixed: braintunnel registry / brain-app repository (see docs/digitalocean.md).
#
# Optional:
#   DOCKER_IMAGE_TAG — image tag (default: version from package.json)
#   DOCKER_PUBLISH_LATEST — set to 0 to skip tagging/pushing :latest (default: also push :latest)
#   DOCKER_PUBLISH_PLATFORM — image/ripmail arch (default: linux/amd64)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOCKER_IMAGE='registry.digitalocean.com/braintunnel/brain-app'

TAG="${DOCKER_IMAGE_TAG:-}"
if [[ -z "$TAG" ]]; then
  if [[ -n "${npm_package_version:-}" ]]; then
    TAG="$npm_package_version"
  else
    TAG="$(node -p "require('./package.json').version")"
  fi
fi

PLATFORM="${DOCKER_PUBLISH_PLATFORM:-linux/amd64}"
export DOCKER_PLATFORM="$PLATFORM"
npm run docker:ripmail:build

TAG_ARGS=(-t "$DOCKER_IMAGE:$TAG")
if [[ "${DOCKER_PUBLISH_LATEST:-1}" != "0" ]]; then
  TAG_ARGS+=(-t "$DOCKER_IMAGE:latest")
fi

docker buildx build --platform "$PLATFORM" -f Dockerfile \
  "${TAG_ARGS[@]}" \
  --push \
  .

echo "docker-publish-do: pushed $DOCKER_IMAGE:$TAG"
if [[ "${DOCKER_PUBLISH_LATEST:-1}" != "0" ]]; then
  echo "docker-publish-do: pushed $DOCKER_IMAGE:latest"
fi
