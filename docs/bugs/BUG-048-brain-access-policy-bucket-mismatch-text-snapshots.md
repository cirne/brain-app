# BUG-048: Brain access — “Trusted” collaborator shows under “Other policy” (text snapshot mismatch)

**Status:** Open (root cause: Phase 0 data model)  
**Fix direction:** [OPP-100](../opportunities/OPP-100-brain-query-policy-records-and-grant-fk.md) — **policy rows + `policy_id` on grants**, not more client-side string matching.

## Symptom

In **Hub → Brain access**, the same peer can appear under **“Other policy”** in **Policies & collaborators** while **“Brains you can ask”** shows **“Trusted Confidante”** (or similar), even though the user did not intend different policies. Buckets are derived from **per-grant copied text**, which can disagree across directions or drift from templates.

## Root cause

Grants store **full privacy policy prose** per row; the UI **classifies** by matching that text to templates. Any difference (default seed vs template, minor formatting, one side’s snapshot) produces a different bucket **without** a stable policy id.

## Resolution

Ship **server-owned policy records** and **`policy_id` on grants** so classification and enforcement both key off the same reference. See [Denormalized `privacy_policy` §](../architecture/brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up).

**Workaround today:** use **Change policy** / re-save from the intended preset so the stored text matches the template (fragile).
