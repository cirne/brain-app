#!/bin/sh
set -e

WIKI_DIR="${WIKI_DIR:-/wiki}"
# Full authenticated HTTPS clone URL (e.g. https://x-access-token:PAT@github.com/org/repo.git).
# If unset, clones the public brain repo (read-only). Do not echo this value.
WIKI_REMOTE="${WIKI_GIT_TOKEN:-https://github.com/cirne/brain}"

# Git identity required for auto-sync commits; override via env vars if desired.
git config --global user.name  "${GIT_USER_NAME:-brain-app}"
git config --global user.email "${GIT_USER_EMAIL:-brain-app@localhost}"

# Clone wiki if not present, otherwise pull latest
if [ -d "$WIKI_DIR/.git" ]; then
  echo "Pulling wiki (WIKI_DIR=$WIKI_DIR)..."
  if git -C "$WIKI_DIR" pull --ff-only; then
    echo "Wiki pull OK."
  else
    echo "Wiki pull failed — diagnostics:"
    git -C "$WIKI_DIR" remote -v 2>&1 | sed 's|\(https://\)[^@]*@|\1***@|g' || true
    git -C "$WIKI_DIR" rev-parse --short HEAD 2>&1 || true
    echo "Tip: git@ origins need openssh-client + keys in the container; HTTPS origin avoids ssh."
    echo "Continuing with cached copy."
  fi
else
  echo "Cloning wiki into $WIKI_DIR..."
  git clone "$WIKI_REMOTE" "$WIKI_DIR"
fi

RM_HOME="${RIPMAIL_HOME:-/ripmail}"
RM_BIN="${RIPMAIL_BIN:-ripmail}"
RIPMAIL_EMAIL_RESOLVED="${RIPMAIL_EMAIL_ADDRESS:-$RIPMAIL_EMAIL}"

ripmail_just_setup=false
if [ -n "$RIPMAIL_EMAIL_RESOLVED" ] && [ -n "${RIPMAIL_IMAP_PASSWORD:-}" ]; then
  if [ ! -f "$RM_HOME/config.json" ]; then
    echo "Running ripmail setup (no config at $RM_HOME/config.json)..."
    "$RM_BIN" setup \
      --email "$RIPMAIL_EMAIL_RESOLVED" \
      --password "$RIPMAIL_IMAP_PASSWORD"
    ripmail_just_setup=true
  fi
fi
if [ "$ripmail_just_setup" = true ]; then
  echo "Starting ripmail backfill (1y) in background..."
  "$RM_BIN" refresh --since 1y &
fi

echo "Running sync (wiki, inbox, calendar)..."
node dist/server/sync-cli.js

echo "Starting server..."
exec node dist/server/index.js
