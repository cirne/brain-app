# Archived: OPP-094 — Holistic onboarding & background task orchestration

**Status: Archived (2026-05-12).** Removed from the active backlog (shipped or no longer pursued).


---

## Original spec (historical)

### OPP-094: Holistic Onboarding & Background Task Orchestration

**Status:** Archived — core integration landed (`GET /api/background-status`, auto wiki kick, Hub activity section, orchestrator queue). **Engineering:** [background-task-orchestration.md](../../architecture/background-task-orchestration.md) (HTTP, troubleshooting); **Your Wiki pipeline:** [your-wiki-background-pipeline.md](../../architecture/your-wiki-background-pipeline.md).

**Related:** [OPP-093 (archived)](./OPP-093-phased-onboarding-sync.md) (phased backfill — superseded by this holistic view), [OPP-067 (archived)](./OPP-067-wiki-buildout-agent-no-new-pages.md) (wiki deepen-only spec — **planning** continues in [OPP-095](./OPP-095-wiki-first-draft-bootstrap.md)), [OPP-054](./OPP-054-guided-onboarding-agent.md) (guided onboarding), [onboarding-state-machine.md](../../architecture/onboarding-state-machine.md), [yourWikiSupervisor.ts](../../../src/server/agent/yourWikiSupervisor.ts)

---

## Problem

The onboarding flow has **three parallel tracks** that need coordination:

1. **Email indexing:** Phase 1 (30d) → interview gate → Phase 2 (1y) → ongoing refresh
2. **Onboarding interview:** Requires minimum corpus, produces `me.md` and preferences
3. **Wiki buildout:** Iterative enrichment laps that deepen as more mail arrives

**Current gaps:**

- **No automatic wiki supervisor start** after onboarding completes
- **Email threshold too low:** 200 messages (not enough signal for quality onboarding)
- **No unified background task status:** Hub polls separate endpoints (`/api/inbox/mail-sync-status`, `/api/hub-events` for wiki)
- **Unclear timing for wiki start:** When is there "enough" email for first wiki lap?
- **Poor visibility:** Background work (backfill phase 2, wiki laps) invisible or scattered across UI

**User experience:**
- Users complete onboarding but wiki never automatically starts building
- Hub shows fragmented status across multiple sections
- No clear sense of "system is working in background" vs "waiting for user action"

---

## Goal

**End-to-end orchestrated flow:** From first email connection → interview-ready → interview complete → wiki building → fully operational, with:

1. **Clear milestones and triggers** for each transition
2. **Automatic wiki supervisor start** at the right moment
3. **Unified background task status API** for Hub to poll
4. **Visible progress** for all background work (backfill, wiki laps)
5. **Right-sized thresholds** based on user delight, not arbitrary numbers

---

## Design: Gated Milestones

### Milestone 1: INTERVIEW_READY
**Trigger:** 500 messages indexed (increased from 200) **AND** phase 1 backfill complete  
**Actions:**
- Onboarding state advances from `indexing` to `onboarding-agent`
- Phase 2 (1y) backfill starts in background
- User enters guided interview

**Rationale:** 500 messages gives enough signal for:
- Understanding who the user talks to regularly
- Identifying key topics and priorities
- Quality onboarding questions without shallow guesses

### Milestone 2: WIKI_READY [NEW]
**Trigger:** Interview state transitions to `done` **AND** one of:
- **Option A (time-based):** Phase 2 has been running for 15+ minutes
- **Option B (message-based):** 1000+ messages indexed total
- **Option C (immediate):** Interview `done` alone (rely on phase 1's 30d being "enough")

**Actions:**
- Call `ensureYourWikiRunning()` automatically
- Wiki supervisor begins first enrich → cleanup lap
- Hub shows wiki status alongside mail status

**Rationale:** 
- Don't start wiki too early (shallow pages waste tokens, confuse user)
- Don't wait until phase 2 completes (1y backfill could take hours; user sees no activity)
- First lap can operate on phase 1 corpus (30d); subsequent laps deepen as more mail arrives

**Recommendation:** Start with **Option B (1000+ messages)** as a conservative middle ground. Adjust based on user feedback about page quality.

**Update (OPP-095 landed):** Indexed mail ≥ **1000** still **gates** kick logic, but **continuous** supervisor auto-start waits for **wiki first-draft bootstrap** to finish (`chats/onboarding/wiki-bootstrap.json` **completed** or **failed**) or **skipped** (`WIKI_BOOTSTRAP_SKIP`). **`GET /api/background-status`** exposes **`wiki.bootstrap`** and treats **`milestones.wikiReady`** as **interview `done` + threshold + bootstrap terminal** (not “indexed only”).

### Milestone 3: FULLY_SYNCED
**Trigger:** Phase 2 (1y) backfill complete  
**State:** 
- Full year of email indexed
- Wiki has been running laps, compounding knowledge
- User can ask about year-old context with confidence

**No explicit action needed** — this is a passive milestone; the system is "done" with initial setup.

---

## Architecture: Parallel Tracks

```
Timeline: First Connection → Ready to Delight

┌─────────────────────────────────────────────────────────────────┐
│ Email Indexing Track                                            │
├─────────────────────────────────────────────────────────────────┤
│ Phase 1: backfill 30d (background) → 500+ msgs                 │
│    ↓                                                             │
│ GATE: INTERVIEW_READY                                           │
│    ↓                                                             │
│ Phase 2: backfill 1y (background, parallel with interview)     │
│    ↓                                                             │
│ Ongoing: refresh (Hub-driven, scheduled)                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Onboarding Interview Track                                      │
├─────────────────────────────────────────────────────────────────┤
│ Wait for INTERVIEW_READY                                        │
│    ↓                                                             │
│ Guided interview (5 phases, produces me.md)                     │
│    ↓                                                             │
│ State: done                                                     │
│    ↓                                                             │
│ GATE: WIKI_READY                                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Wiki Buildout Track                                             │
├─────────────────────────────────────────────────────────────────┤
│ Wait for WIKI_READY                                             │
│    ↓                                                             │
│ Start yourWikiSupervisor (ensureYourWikiRunning)               │
│    ↓                                                             │
│ Lap 1: enrich → cleanup (operates on phase 1 + partial phase 2)│
│    ↓                                                             │
│ Lap 2, 3, …: continuous enrichment (deepens as more mail)      │
│    ↓                                                             │
│ Idle after N no-op laps; wake on mail sync or user request     │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** Phase 2 backfill and wiki buildout **run in parallel**. Wiki doesn't wait for full 1y sync; it starts on "enough" signal and deepens iteratively.

---

## Refactoring Opportunities

### 1. Unified Background Task Status API

**Problem:** Hub polls multiple endpoints:
- `/api/inbox/mail-sync-status` for email
- `/api/hub-events` SSE for wiki + background agents
- Separate logic for onboarding vs post-onboarding mail status

**Proposal:** Single unified route:

```
GET /api/background-status
```

**Response shape:**

```typescript
{
  mail: {
    indexedTotal: number
    configured: boolean
    syncRunning: boolean
    backfillRunning: boolean
    refreshRunning: boolean
    lastSyncedAt: string | null
    syncLockAgeMs: number | null
    statusError?: string
  },
  wiki: {
    status: 'idle' | 'paused' | 'running' | 'queued'
    phase: YourWikiPhase
    pageCount: number
    detail: string
    lastRunAt: string | null
  },
  onboarding: {
    state: OnboardingMachineState
    wikiMeExists: boolean
  },
  // Future: other background tasks (Drive sync, Messages export, etc.)
}
```

**Benefits:**
- Single fetch for all Hub status
- Consistent shape regardless of onboarding vs post-onboarding
- Easy to extend for future background tasks (Drive, Messages, etc.)
- SSE can push delta updates when background work progresses

**Implementation:**
- Create `src/server/routes/backgroundStatus.ts`
- Consolidate logic from `onboarding.ts` (mail status), `inbox.ts` (sync status), `hubEvents.ts` (wiki doc)
- Update Hub to poll unified endpoint
- SSE can still push granular events; unified GET is baseline

### 2. Automatic Wiki Supervisor Start Hook

**Problem:** `ensureYourWikiRunning()` is only called from explicit API routes, never automatically triggered.

**Proposal:** Add hook in onboarding state transition:

```typescript
// In src/server/routes/onboarding.ts, inside PATCH /state handler
if (next === 'done' && cur.state !== 'done') {
  // Check wiki-ready gate (e.g., 1000+ messages)
  const mail = await getOnboardingMailStatus()
  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  
  if (indexed >= WIKI_BUILDOUT_MIN_MESSAGES) {
    console.log('[onboarding/state] Starting wiki supervisor (WIKI_READY gate passed)')
    void ensureYourWikiRunning().catch(e => 
      console.error('[onboarding/state] wiki supervisor start failed:', e)
    )
  } else {
    console.log(
      `[onboarding/state] Wiki supervisor deferred until ${WIKI_BUILDOUT_MIN_MESSAGES} messages indexed (current: ${indexed})`
    )
    // Optional: register a periodic check or wait for next sync:completed event
  }
}
```

**Threshold constant:**
```typescript
// src/shared/onboardingProfileThresholds.ts
export const ONBOARDING_PROFILE_INDEX_MANUAL_MIN = 500
export const WIKI_BUILDOUT_MIN_MESSAGES = 1000
```

### 3. Hub UX: Unified Background Activity Section

**Current:** Wiki status in one place, mail status in another, fragmented visibility.

**Proposal:** Single "Background Activity" section in Hub showing:

```
Background Activity
├─ Email Index: 2,453 messages · Syncing (backfill 1y, 45m) · Last: 2m ago
├─ Wiki: 47 pages · Enriching (lap 3) · Run lap now
└─ [Future: Drive, Messages, etc.]
```

**Interaction:**
- Expand/collapse for details (sync log tail, wiki timeline)
- Manual triggers: "Sync now", "Run wiki lap"
- Pause/resume for wiki
- Clear visibility: "System is working" vs "Idle"

---

## Thresholds and Rationale

| Threshold | Value | Rationale |
|-----------|-------|-----------|
| Interview ready | **500 messages** | Enough signal for quality onboarding questions; understanding of regular contacts and key topics. **Not adaptive** — hard constant for simplicity. |
| Wiki buildout start | **1000 messages** | Conservative: 2x interview minimum ensures depth before first lap. Avoids shallow pages that need immediate rewrite. |
| Interview minimum (floor) | 500 (no retry below) | If user has low volume (<500 in 30d), they see "waiting" state with manual continue option. |
| Wiki lap idle backoff | 3 no-op laps | Existing `yourWikiSupervisor` behavior; no change needed. |

**Trade-offs:**
- **Speed vs. quality:** 500/1000 thresholds favor quality over fast onboarding. User with high volume (>500/day) gets through quickly; low volume waits longer but gets better results.
- **Failure mode:** If wiki starts "too early" (e.g., 1000 not enough), user may see shallow pages. **Mitigation:** wiki buildout agent re-enriches on subsequent laps; users can report via in-app feedback (`product_feedback` tool).

---

## Implementation Plan

### Phase 1: Thresholds and Automatic Wiki Start
- Update `ONBOARDING_PROFILE_INDEX_MANUAL_MIN` to 500
- Add `WIKI_BUILDOUT_MIN_MESSAGES = 1000`
- Hook `ensureYourWikiRunning()` in onboarding `done` transition
- Add logging for gate decisions (interview ready, wiki ready)

### Phase 2: Unified Background Status API
- Create `GET /api/background-status` route
- Consolidate mail/wiki/onboarding status logic
- Update Hub to poll unified endpoint
- Deprecate separate `/api/inbox/mail-sync-status` (or alias to new route)

### Phase 3: Hub UX Polish
- Unified "Background Activity" section
- Expand/collapse for details
- Manual triggers (sync, wiki lap)
- Visible "system is working" indicators

### Phase 4: Documentation
- Update `onboarding-state-machine.md` with milestone gates and parallel tracks diagram
- Add threshold rationale table
- Document unified background status API contract
- Add troubleshooting section: "Wiki not starting after onboarding"

---

## Success Criteria

- **Zero manual wiki starts:** 100% of users who complete onboarding see wiki supervisor running automatically (when 1000+ messages indexed)
- **Threshold validation:** Interview quality improves with 500-message minimum (measure via in-app feedback or manual review)
- **Hub clarity:** Users can see at a glance: "Email syncing (1y backfill), Wiki building (lap 2), Last update 5m ago"
- **No regressions:** Existing onboarding flow (30d → interview → 1y) works unchanged except for new thresholds and wiki start

---

## Future Work (Out of Scope)

- **Adaptive thresholds:** Dynamic adjustment based on user volume patterns (e.g., "wait max 1 hour for 500, then proceed with whatever you have")
- **User-facing progress:** Onboarding UI shows "Email: 342/500 indexed, Wiki: waiting for 1000" during phase 1
- **Multiple mailboxes:** How do thresholds apply when adding a second Gmail account mid-onboarding?
- **Calendar integration:** Separate background task for calendar sync/enrichment (future OPP)

---

## Open Questions

1. **Wiki ready trigger:** Start with 1000-message threshold, or add 15-minute time gate as safety (whichever comes first)?
2. **Low-volume users:** If 30d backfill yields <500 messages, should we auto-extend to 90d or prompt user to add more accounts?
3. **Hub SSE vs polling:** Should unified background status use SSE push for all updates, or hybrid (poll for baseline, SSE for deltas)?
4. **Onboarding vs Hub visibility:** Should onboarding UI show "Wiki will start after interview + 1000 messages" as a preview/explainer?
