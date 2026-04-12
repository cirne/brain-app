#!/bin/sh
set -e

WIKI_DIR="${WIKI_DIR:-/wiki}"
WIKI_REPO="${WIKI_REPO:-https://github.com/cirne/brain}"

# Clone wiki if not present, otherwise pull latest
if [ -d "$WIKI_DIR/.git" ]; then
  echo "Pulling wiki..."
  git -C "$WIKI_DIR" pull --ff-only || echo "Wiki pull failed, continuing with cached copy"
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
