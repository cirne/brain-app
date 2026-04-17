#!/bin/sh
set -e

WIKI_DIR="${WIKI_DIR:-/wiki}"
# Wiki is plain markdown on disk (no git clone/pull in this stack).
mkdir -p "$WIKI_DIR"
echo "Wiki dir ready (WIKI_DIR=$WIKI_DIR)."

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
