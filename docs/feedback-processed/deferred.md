# Deferred in-app feedback

Items listed here are **intentionally not** promoted to `docs/bugs/` or `docs/opportunities/` yet (or were parked after triage). For feedback ids **#4, #5, #7, #8** the authoritative triage record is a row in [`registry.md`](./registry.md) (links here for detail).

| Feedback id | Title (short) | Why deferred / revisit |
| ----------- | ---------------- | ------------------------ |
| 4 | Blur / hide sensitive email & message preview content | Privacy UX; scope across snippets + tool surfaces; not blocking core flows. Revisit if screen-share or shared-device users increase. |
| 5 | SSE auto-refresh session across multiple clients | Significant product + infra; smaller alternatives (refresh, single-tab) first. Revisit with mobile + [archived OPP-008](../opportunities/archive/OPP-008-tunnel-qr-phone-access.md) use. |
| 7 | Wiki Back / Forward (browser-style history) | [OPP-027](../opportunities/archive/OPP-027-wiki-nav-indicator-and-activity-surface.md) did not cover in-wiki history. Revisit after wiki nav stabilizes. |
| 8 | Accept / decline / propose time for **external** calendar invites | Write Calendar scope + assistant UX + OAuth/verification path ([OPP-043](../opportunities/OPP-043-google-oauth-app-verification-milestones.md)). Revisit with calendar product milestone. |

**Filed as bugs:** **#6** → [BUG-021](../bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md), **#9** → [BUG-022](../bugs/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md).

When a deferred item is **scheduled** or **rejected**, remove its row from this table, update the **`registry.md`** **Tracked as** link to the new or updated BUG/OPP, and record **Won’t do** in a footer note with date if applicable.
