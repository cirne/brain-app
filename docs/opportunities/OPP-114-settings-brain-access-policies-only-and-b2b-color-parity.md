# OPP-114 — Settings brain access: policies only; tunnel UI owns grants; B2B color parity

## Problem

The **Settings → Brain-to-brain access** surface (`BrainAccessPage.svelte`) mixes two concerns:

1. **Policy catalog** — named presets (Trusted confidante, General collaborator, Minimal disclosure), custom policies, and the prose the filter model uses.
2. **Grant / collaborator management** — who is mapped to which policy (`PolicyCard` add/remove handles, per-grant policy changes via `ChangePolicyDialog`, and **Brains you can ask** via `OutboundGrantsList`).

Tunnels is now the primary place users connect workspaces, see activity, and reason about **who** has access. Duplicating grant management under Settings buries the mental model and invites stale or conflicting UX (“do I change this here or under Tunnels?”).

## Proposed direction

### 1. Narrow Settings to policy editing

- **Remove from Settings** (or stop routing users there for):
  - Assigning collaborators to policies (`onAddUser`, collaborator pills on policy cards).
  - Per-grant policy swap flows wired from Settings (`ChangePolicyDialog` in this page, if nothing else needs it).
  - The **inbound / “brains you can ask”** list (`OutboundGrantsList`).
- **Keep in Settings** a focused **policy editor** experience:
  - List policies (built-ins + custom) with **inline or drill-down edit** of the policy definition — title, short description, and the policy **text** / instructions the runtime uses (aligned with today’s `PolicyDetailPage` / custom policy storage patterns).
  - **Create custom policy** remains here (or moves only if product IA changes); the deciding factor is “definition of rules,” not “who uses them.”

**Principle:** Settings answers “what are my policy presets?” Tunnels answers “who is connected, and effective policy per connection.”

### 2. Reuse policy colors in the main B2B policy picker

Built-in policies already have stable visual identities in the access settings cards (**purple** / trusted, **blue** / general, **green** / minimal disclosure), encoded in `src/client/components/brain-access/policyColors.ts` (`policyCardTone` + `BrainQueryBuiltInPolicyId`).

**Requirement:** Any **primary B2B policy picker** in the Tunnel connection flow (e.g. dialogs or panels that let the user pick which preset applies) should **reuse the same tone tokens** so users recognize “this is the same three policies” across Settings cards, Tunnel detail, and review/cold flows. Custom policies should continue to use the same **rotation** / `colorIndex` behavior as `policyColors.ts` for consistency.

Avoid one-off accent colors in the picker that don’t match the policy list cards.

### 3. Cross-browser policy picker (`<select>`)

The tunnel connection **policy dropdown** is a plain HTML `<select>` in [`TunnelDetail.svelte`](../../src/client/components/TunnelDetail.svelte) (`policyDropdown` snippet): Tailwind sets border, background, and radius, but **Safari still paints much of the control with native WebKit/AppKit chrome** (e.g. the stacked arrow), while **Chromium** uses its own closed-state rendering—so the control looks more “on-brand” in Chrome than in Safari without extra work.

**Deferred here:** When this OPP’s picker work ships (custom menu or `appearance: none` + spacing + custom chevron, aligned with `SegmentedControl`-level polish), treat **Safari/Chrome parity** as part of that change rather than a one-off hotfix.

## Code pointers (current)

- Settings shell: [`src/client/components/brain-access/BrainAccessPage.svelte`](../../src/client/components/brain-access/BrainAccessPage.svelte)
- Policy cards + add-user affordances: [`src/client/components/brain-access/PolicyCard.svelte`](../../src/client/components/brain-access/PolicyCard.svelte)
- Inbound grants list: [`src/client/components/brain-access/OutboundGrantsList.svelte`](../../src/client/components/brain-access/OutboundGrantsList.svelte)
- Per-grant policy dialog (radio list): [`src/client/components/brain-access/ChangePolicyDialog.svelte`](../../src/client/components/brain-access/ChangePolicyDialog.svelte)
- Shared colors: [`src/client/components/brain-access/policyColors.ts`](../../src/client/components/brain-access/policyColors.ts)
- Templates / built-in ids: [`src/client/lib/brainQueryPolicyTemplates.ts`](../../src/client/lib/brainQueryPolicyTemplates.ts)
- Tunnel-side policy UX: [`src/client/components/TunnelDetail.svelte`](../../src/client/components/TunnelDetail.svelte)

## Success criteria

- Users are not asked to **add/remove collaborators** or manage **brains you can ask** from Settings; those flows live under **Tunnels** (and any Hub summary remains a **shortcut**, not a second editor).
- Settings still allows **creating and editing** policy definitions users rely on across connections.
- Policy selection UI in Tunnel / B2B paths **visually matches** the Settings policy identity (same bar/soft-bg/ring tones per built-in id and consistent custom rotation).
- The tunnel policy **dropdown** looks consistent across Safari and Chromium (no reliance on native `<select>` affordance alone).

## Related

- Shipped B2B admin context: [architecture/brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)
- Tunnel activity surface (archived): [archive/OPP-113-tunnel-connections-unified-activity-surface.md](./archive/OPP-113-tunnel-connections-unified-activity-surface.md)
- Chat-native B2B (archived): [archive/OPP-110-chat-native-brain-to-brain.md](./archive/OPP-110-chat-native-brain-to-brain.md)
