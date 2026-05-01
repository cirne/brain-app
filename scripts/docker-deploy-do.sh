#!/usr/bin/env bash
# Build a Linux image (default linux/amd64) with arch-matched ripmail, push to DigitalOcean Container Registry,
# tag the current commit with a deploy-* identifier, push the tag, and record a New Relic staging deployment marker.
#
# Prerequisites:
#   - docker buildx; registry login (e.g. ./scripts/doctl-brain.sh registry login).
#   - On branch main, clean working tree (no staged/unstaged changes to tracked files); git remote origin.
#   - For New Relic marker: `newrelic` CLI on PATH and NEW_RELIC_API_KEY (user API key NRAK-…), unless SKIP_NEW_RELIC_DEPLOYMENT=1.
#
# Image path is fixed: braintunnel registry / brain-app repository (see docs/digitalocean.md).
#
# Environment:
#   DOCKER_IMAGE_TAG — image tag and git tag (default: UTC deploy-YYYYMMDD-HHMMSSutc)
#   DOCKER_PUBLISH_LATEST — set to 0 to skip tagging/pushing :latest (default: also push :latest)
#   DOCKER_PUBLISH_PLATFORM — image/ripmail arch (default: linux/amd64)
#   NEW_RELIC_API_KEY — user API key for `newrelic` CLI (not the Node license key)
#   NEW_RELIC_DEPLOY_USER — optional; defaults to git user.email or whoami
#   SKIP_NEW_RELIC_DEPLOYMENT — set to 1 to skip recording the NR deployment marker (still builds/pushes/tags git)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOCKER_IMAGE='registry.digitalocean.com/braintunnel/brain-app'
NR_ACCOUNT_ID='3774651'
NR_ENTITY_GUID='Mzc3NDY1MXxBUE18QVBQTElDQVRJT058NjE4MjQwMjM3'

ensure_git_deploy_ready() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "docker-deploy-do: not a git repository" >&2
    exit 1
  }
  local branch
  branch="$(git branch --show-current 2>/dev/null || true)"
  if [[ "$branch" != "main" ]]; then
    echo "docker-deploy-do: must be on branch main (current: ${branch:-detached})" >&2
    exit 1
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "docker-deploy-do: working tree must be clean (no staged or unstaged changes)" >&2
    exit 1
  fi
  git remote get-url origin >/dev/null 2>&1 || {
    echo "docker-deploy-do: git remote origin is required" >&2
    exit 1
  }
}

TAG="${DOCKER_IMAGE_TAG:-}"
if [[ -z "$TAG" ]]; then
  TAG="$(date -u +deploy-%Y%m%d-%H%M%Sutc)"
fi

ensure_git_deploy_ready

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

echo "docker-deploy-do: pushed $DOCKER_IMAGE:$TAG"
if [[ "${DOCKER_PUBLISH_LATEST:-1}" != "0" ]]; then
  echo "docker-deploy-do: pushed $DOCKER_IMAGE:latest"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "docker-deploy-do: git tag $TAG already exists locally" >&2
  exit 1
fi
if git ls-remote origin "refs/tags/$TAG" | grep -q .; then
  echo "docker-deploy-do: git tag $TAG already exists on origin" >&2
  exit 1
fi

git tag -a "$TAG" -m "docker deploy $TAG"
git push origin "$TAG"
echo "docker-deploy-do: pushed git tag $TAG"

COMMIT_SHA="$(git rev-parse HEAD)"
DEPLOY_USER="${NEW_RELIC_DEPLOY_USER:-$(git config user.email 2>/dev/null || whoami)}"

if [[ "${SKIP_NEW_RELIC_DEPLOYMENT:-0}" == "1" ]]; then
  echo "docker-deploy-do: skipping New Relic deployment marker (SKIP_NEW_RELIC_DEPLOYMENT=1)" >&2
  exit 0
fi

if ! command -v newrelic >/dev/null 2>&1; then
  echo "docker-deploy-do: newrelic CLI not found on PATH; install it or set SKIP_NEW_RELIC_DEPLOYMENT=1" >&2
  exit 1
fi
if [[ -z "${NEW_RELIC_API_KEY:-}" ]]; then
  echo "docker-deploy-do: NEW_RELIC_API_KEY is required for deployment marker (user API key), or set SKIP_NEW_RELIC_DEPLOYMENT=1" >&2
  exit 1
fi

newrelic entity deployment create \
  --accountId "$NR_ACCOUNT_ID" \
  --guid "$NR_ENTITY_GUID" \
  --version "$TAG" \
  --commit "$COMMIT_SHA" \
  --description "Docker deploy $TAG" \
  --changelog "Image $DOCKER_IMAGE:$TAG" \
  --deploymentType BASIC \
  --user "$DEPLOY_USER"

echo "docker-deploy-do: recorded New Relic deployment for Braintunnel Staging (version=$TAG commit=$COMMIT_SHA)"
