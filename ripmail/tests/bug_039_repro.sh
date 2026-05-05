#!/bin/bash
# BUG-039 Reproduction: ripmail archive treats leading-dash Message-ID as CLI flag
# https://github.com/cirne/zmail
#
# Demonstrates the parsing bug with Message-IDs that begin with a hyphen character,
# such as "-OSgr@geopod-ismtpd-101" (real DigitalOcean message ID pattern).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=== BUG-039 Reproduction: Leading-dash Message-ID ==="
echo ""

# Build ripmail first
echo "Building ripmail..."
cargo build --bin ripmail --quiet
RIPMAIL_BIN="$REPO_ROOT/target/debug/ripmail"

echo ""
echo "--- Test 1: Message-ID with leading dash (BUG) ---"
echo "Command: ripmail archive -OSgr@geopod-ismtpd-101"
echo ""
OUTPUT1=$($RIPMAIL_BIN archive -OSgr@geopod-ismtpd-101 2>&1 || true)
echo "$OUTPUT1"
if echo "$OUTPUT1" | grep -q "unrecognized flag"; then
    echo ""
    echo "✓ BUG REPRODUCED: Leading dash parsed as flag"
else
    echo ""
    echo "✗ Unexpected: Did not see flag parsing error"
fi

echo ""
echo "--- Test 2: Workaround using -- (end-of-options) ---"
echo "Command: ripmail archive -- -OSgr@geopod-ismtpd-101"
echo ""
OUTPUT2=$($RIPMAIL_BIN archive -- -OSgr@geopod-ismtpd-101 2>&1 || true)
echo "$OUTPUT2"
if echo "$OUTPUT2" | grep -q "RIPMAIL_HOME"; then
    echo ""
    echo "✓ WORKAROUND SUCCESS: -- terminates flag parsing"
    echo "  (Got past CLI parsing; failed on missing config, which is expected)"
else
    echo ""
    echo "✗ Unexpected: Should have gotten past CLI parsing"
fi

echo ""
echo "--- Test 3: Normal message ID (no leading dash) ---"
echo "Command: ripmail archive OSgr@geopod-ismtpd-101"
echo ""
OUTPUT3=$($RIPMAIL_BIN archive OSgr@geopod-ismtpd-101 2>&1 || true)
echo "$OUTPUT3"
if echo "$OUTPUT3" | grep -q "RIPMAIL_HOME"; then
    echo ""
    echo "✓ NORMAL CASE: Message-ID without leading dash works"
    echo "  (Got past CLI parsing)"
else
    echo ""
    echo "✗ Unexpected: Normal message ID should parse"
fi

echo ""
echo "=== Summary ==="
echo "BUG-039 is reproduced. Leading-dash Message-IDs are parsed as CLI flags."
echo ""
echo "Current workaround:"
echo "  Use '--' before the message ID: ripmail archive -- -OSgr@..."
echo ""
echo "Suggested fixes (from bug report):"
echo "  1. Require '--' end-of-options before operands"
echo "  2. Add explicit --message-id / -m flag"
echo "  3. Document quoting/escaping rules for agents"
echo ""
