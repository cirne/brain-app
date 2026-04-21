#!/usr/bin/env bash
# Run doctl against the BrainTunnel auth context (see OPP-041 Phase 5).
# Setup once: create a token in the DO control panel while the BrainTunnel team
# is active, then: doctl auth init --context braintunnel -t "$TOKEN"
# Switch default context for all terminals: doctl auth switch --context braintunnel
set -euo pipefail
exec doctl --context braintunnel "$@"
