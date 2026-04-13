#!/bin/sh
set -e

WIKI_DIR="${WIKI_DIR:-/wiki}"
WIKI_REPO="${WIKI_REPO:-https://github.com/cirne/brain}"

# Clone wiki if not present, otherwise pull latest
if [ -d "$WIKI_DIR/.git" ]; then
  echo "Pulling wiki (WIKI_DIR=$WIKI_DIR)..."
  if git -C "$WIKI_DIR" pull --ff-only; then
    echo "Wiki pull OK."
  else
    echo "Wiki pull failed — diagnostics:"
    git -C "$WIKI_DIR" remote -v 2>&1 || true
    git -C "$WIKI_DIR" rev-parse --short HEAD 2>&1 || true
    echo "Tip: git@ origins need openssh-client + keys in the container; HTTPS origin avoids ssh."
    echo "Continuing with cached copy."
  fi
else
  echo "Cloning wiki from $WIKI_REPO..."
  git clone "$WIKI_REPO" "$WIKI_DIR"
fi

# Background cron: pull wiki every 15 minutes
(
  while true; do
    sleep 900
    git -C "$WIKI_DIR" pull --ff-only 2>/dev/null || true
  done
) &

echo "Starting server..."
exec node dist/server/index.js
