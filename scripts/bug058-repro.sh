#!/usr/bin/env bash
# scripts/bug058-repro.sh
#
# BUG-058 integration reproducer / regression test.
#
# Wipes the ripmail DB, starts a fresh Apple Mail sync, waits until
# TARGET_COUNT messages are indexed, then runs `ripmail whoami --verbose`
# and prints whether the result is Lewis (FIXED) or Kirsten (BUG).
#
# Prerequisites
#   • ripmail already configured (`ripmail setup --apple-mail` done; config.json exists)
#   • Apple Mail FDA permission granted
#   • Run from the repo root
#
# Usage
#   bash scripts/bug058-repro.sh               # build then test
#   bash scripts/bug058-repro.sh --skip-build  # reuse existing binary
#
# Exit codes
#   0  FIXED  — primary = lewiscirne@mac.com (or any non-Kirsten apple address)
#   1  BUG    — primary = kirstencirne@mac.com (wrong person)
#   2  UNKNOWN — unexpected output

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RIPMAIL_HOME="${RIPMAIL_HOME:-$REPO_ROOT/data/ripmail}"
BINARY="$REPO_ROOT/target/debug/ripmail"
TARGET_COUNT="${TARGET_COUNT:-2000}"
POLL_INTERVAL=1   # seconds between status polls
SKIP_BUILD="${1:-}"

rip() { RIPMAIL_HOME="$RIPMAIL_HOME" "$BINARY" "$@"; }

# ─── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

echo -e "${BOLD}━━━ BUG-058 reproducer ━━━${RESET}"
echo "  RIPMAIL_HOME : $RIPMAIL_HOME"
echo "  binary       : $BINARY"
echo "  target count : $TARGET_COUNT messages"
echo ""

# ── 0. Sanity: config must exist ────────────────────────────────────────────
if [[ ! -f "$RIPMAIL_HOME/config.json" ]]; then
  echo -e "${RED}ERROR: No config.json at $RIPMAIL_HOME${RESET}"
  echo "  Run: RIPMAIL_HOME=$RIPMAIL_HOME $BINARY setup --apple-mail --no-validate --no-skill"
  exit 3
fi

# ── 1. Build (incremental) ───────────────────────────────────────────────────
if [[ "$SKIP_BUILD" != "--skip-build" ]]; then
  echo -e "${CYAN}[1/5] Building ripmail (incremental)...${RESET}"
  cd "$REPO_ROOT"
  cargo build -p ripmail 2>&1 | grep -E "^(error|warning\[|   Compiling|   Finished)" || true
  echo ""
else
  echo -e "${YELLOW}[1/5] Skipping build (--skip-build)${RESET}"
fi

# ── 2. Wipe DB only (keep config.json) ──────────────────────────────────────
echo -e "${CYAN}[2/5] Wiping ripmail database...${RESET}"
rm -f "$RIPMAIL_HOME/ripmail.db" \
      "$RIPMAIL_HOME/ripmail.db-wal" \
      "$RIPMAIL_HOME/ripmail.db-shm"
echo "      DB wiped."
echo ""

# ── 3. Start Apple Mail refresh in background ────────────────────────────────
REFRESH_LOG="/tmp/ripmail-bug058-refresh-$$.log"
echo -e "${CYAN}[3/5] Starting Apple Mail refresh (background)...${RESET}"
rip refresh --since 1y --foreground > "$REFRESH_LOG" 2>&1 &
SYNC_PID=$!

cleanup() {
  kill "$SYNC_PID" 2>/dev/null || true
  wait "$SYNC_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "      sync PID : $SYNC_PID  (log: $REFRESH_LOG)"
echo ""

# ── 4. Poll until >= TARGET_COUNT messages ───────────────────────────────────
echo -e "${CYAN}[4/5] Polling every ${POLL_INTERVAL}s for $TARGET_COUNT messages...${RESET}"
COUNT=0
DOTS=0
while [[ "$COUNT" -lt "$TARGET_COUNT" ]]; do
  sleep "$POLL_INTERVAL"

  # check if sync died early
  if ! kill -0 "$SYNC_PID" 2>/dev/null; then
    echo ""
    echo -e "${YELLOW}  Sync process exited early — checking final count...${RESET}"
    STATUS=$(rip status --json 2>/dev/null || echo '{"search":{"indexedMessages":0}}')
    COUNT=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['search']['indexedMessages'])" 2>/dev/null || echo 0)
    echo "  Final count: $COUNT messages"
    if [[ "$COUNT" -lt "$TARGET_COUNT" ]]; then
      echo -e "${RED}  Sync ended before reaching $TARGET_COUNT — try again${RESET}"
      echo "  Refresh log tail:"
      tail -20 "$REFRESH_LOG"
      exit 3
    fi
    break
  fi

  STATUS=$(rip status --json 2>/dev/null || echo '{"search":{"indexedMessages":0}}')
  COUNT=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['search']['indexedMessages'])" 2>/dev/null || echo 0)
  printf "  %5d messages indexed\r" "$COUNT"
  DOTS=$((DOTS + 1))
done

echo ""
echo -e "      Reached ${BOLD}$COUNT${RESET} messages — stopping sync..."
kill "$SYNC_PID" 2>/dev/null || true
wait "$SYNC_PID" 2>/dev/null || true
trap - EXIT
# Give the DB a moment to flush and release the write lock before we query it.
sleep 2
echo ""

# ── 5. Run whoami --verbose ──────────────────────────────────────────────────
echo -e "${CYAN}[5/5] Running whoami --verbose at $COUNT messages...${RESET}"
echo "──────────────────────────────────────────────────────────"
WHOAMI_OUT=$(rip whoami --verbose 2>&1)
echo "$WHOAMI_OUT"
echo "──────────────────────────────────────────────────────────"
echo ""

# ── 6. Diagnose ─────────────────────────────────────────────────────────────
# Extract the JSON primary email (whoami output is multi-line JSON mixed with [whoami] lines)
_PY='
import json, sys, re
text = sys.stdin.read()
m = re.search(r"(\{[\s\S]+\})", text)
if m:
    try:
        d = json.loads(m.group(1))
        mbs = d.get("mailboxes", [])
        inf = (mbs[0].get("inferred") or {}) if mbs else {}
        print(inf.get("primaryEmail", ""))
    except Exception:
        pass
'
PRIMARY=$(echo "$WHOAMI_OUT" | python3 -c "$_PY" 2>/dev/null || echo "")

echo "Primary email: ${PRIMARY:-<none detected>}"
echo ""

if [[ -z "$PRIMARY" ]]; then
  echo -e "${YELLOW}⚠  No primary email detected — check whoami output above${RESET}"
  exit 2
elif echo "$PRIMARY" | grep -qi "kirsten"; then
  echo -e "${RED}${BOLD}❌ BUG CONFIRMED at $COUNT messages${RESET}"
  echo -e "${RED}   Got Kirsten — Lewis was not a candidate${RESET}"
  echo ""
  echo "Diagnostic queries against the partial DB:"
  echo "  sqlite3 $RIPMAIL_HOME/ripmail.db \"SELECT lower(j.value), COUNT(*) FROM messages m JOIN json_each(m.to_addresses) j WHERE source_id='applemail_local' AND (lower(j.value) LIKE '%@mac.com' OR lower(j.value) LIKE '%@icloud.com' OR lower(j.value) LIKE '%@me.com') AND m.list_like=0 GROUP BY 1 ORDER BY 2 DESC LIMIT 10;\""
  exit 1
elif echo "$PRIMARY" | grep -qi "lewis"; then
  echo -e "${GREEN}${BOLD}✅ FIXED at $COUNT messages — primary = $PRIMARY${RESET}"
  exit 0
else
  echo -e "${YELLOW}⚠  Primary is '$PRIMARY' — not Kirsten or Lewis (unexpected)${RESET}"
  exit 2
fi
