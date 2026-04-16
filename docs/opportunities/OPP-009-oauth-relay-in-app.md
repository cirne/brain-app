# OPP-009: OAuth relay in brain-app (ripmail)

## Summary

The standalone ripmail repo shipped a **Cloudflare Worker** (`oauth-relay/`) for hosted OAuth flows. That subtree was **not** folded into the brain-app monorepo when ripmail became [`ripmail/`](../../ripmail/) here.

## Direction

Implement the same relay behavior **inside brain-app** (Hono routes or a small adjunct service) so Gmail/OAuth flows used by ripmail can complete without depending on the old Worker deployment.

## References

- Ripmail OAuth code under [`ripmail/src/oauth/`](../../ripmail/src/oauth/)
- Prior Worker lived at `oauth-relay/` in the public ripmail repo (archived when that repo is closed)
