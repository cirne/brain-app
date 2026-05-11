# Archived: OPP-100 — Brain-query — server policy records + grant FK

**Status: Archived (2026-05-12).** Removed from the active backlog (shipped or no longer pursued).

**Stub:** [../OPP-100-brain-query-policy-records-and-grant-fk.md](../OPP-100-brain-query-policy-records-and-grant-fk.md)

---

## Original spec (historical)

### OPP-100: Brain-query — server policy records and grant-by-reference

**Status:** Open — **target schema + API**, supersedes string-snapshot workarounds for Phase 0 grants.

**See also:** [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md) (especially [Denormalized `privacy_policy` §](../../architecture/brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up)) · [brain-query-delegation.md](../../architecture/brain-query-delegation.md) · [IDEA: Brain-query delegation](../../ideas/IDEA-brain-query-delegation.md)

## Problem

Today each `brain_query_grants` row stores a **full copy** of the privacy policy text. The Hub UI classifies grants by **comparing** that text to built-in templates and **local** custom-policy storage. That leads to:

- **Mis-bucketing** (“Trusted” vs “Other”) when snapshots differ from templates, defaults, or the peer’s stored text—without the user changing intent ([BUG-048](../../bugs/BUG-048-brain-access-policy-bucket-mismatch-text-snapshots.md)).
- **O(n) updates** when editing a logical policy (PATCH every matching grant).
- **No single SSOT** for “what policy applies to this collaborator?” on the server.

## Goal

1. **Policy table (server, owner-scoped):** persistent rows with `policy_id`, human label, provenance (e.g. seeded-from-template), and **current** policy body (plaintext for the filter pass; structured layers can come later).
2. **Grants reference `policy_id`:** `brain_query_grants` holds `policy_id` (FK / invariant); optional denormalized text only for debugging or perf, not for identity.
3. **Instantiate on use:** when an owner picks “Trusted Confidante” (or a custom preset), **create or select** the corresponding policy row and attach new grants to **`policy_id`**, not to a one-off string snapshot from the client.
4. **Edits propagate:** updating the policy row changes behavior for **all** grants that reference it (default). If we ever need **pinned revisions**, that is an explicit product extension (per-grant `policy_revision_id`), not the baseline.

## Non-goals (this OPP)

- Full **structured** fragment library / hard predicates (Spike 3–4 in the architecture doc)—only the **relational shell** for plaintext policies and grants.
- Moving **custom policies** off the client/localStorage without a product decision (may remain client-authored but must be **persisted** server-side as policy rows when this ships).

## Acceptance

- New schema (global DB or as decided) with **policies** + **`policy_id` on grants**; enforcement resolves text via policy row in `runBrainQuery`.
- API: create/update/list policies; create/update grants by **`policy_id`** (text not required on grant create if preset is explicit).
- Hub: list and edit policies; add collaborators by **policy**; no reliance on string equality to template files for bucketing.
- Tests: `[src/server/**/*.test.ts](../../../src/server/)` for repo + routes; client grouping tests if UI logic remains.

## Related

- Spike 2 alignment: [brain-to-brain-access-policy.md § Spike 2](../../architecture/brain-to-brain-access-policy.md#spike-2-plaintext-plus)
- Archived UI epic: [OPP-099](./archive/OPP-099-brain-to-brain-admin-hub-ui.md)
