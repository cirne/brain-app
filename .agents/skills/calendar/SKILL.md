---
name: calendar
description: Manage calendars, schedule meetings, and control visibility. Use when the user asks to see their schedule, hide/show specific calendars, or schedule new events.
---

# Calendar Management Skill

This skill provides guidance for managing calendars and scheduling using the `calendar` tool.

## Core Tool: `calendar`

The `calendar` tool is the primary interface for all calendar-related actions.

### 1. Visibility Management (Hide/Show)

To control which calendars are visible in the UI or included in default queries, use `op: 'configure_source'`.

- **`calendar_ids`**: The list of all calendars that should be "synced" or available in the UI.
- **`default_calendar_ids`**: The subset of calendars that should be "shown" by default in the main view.
- **`source`**: The ID of the account (e.g., Google, Apple) being configured.

**Workflow to hide/show:**
1. Call `op: 'list_calendars'` to see all available IDs for a source.
2. Call `op: 'configure_source'` with the updated `calendar_ids` and `default_calendar_ids`.

### 2. Accessing Events

- **`op: 'events'`**: Query events for a specific date range.
    - Use `start` and `end` (YYYY-MM-DD).
    - Optionally pass `calendar_ids` to filter the results to specific calendars.

### 3. Scheduling and Assistance

- For complex scheduling assistance (e.g., finding times with others), the system can forward requests to `howie@howie.ai`.
- When the user asks to "schedule a meeting," the agent should use the `calendar` tool to check for conflicts first, then propose times or use external scheduling integrations if configured.

## Best Practices for the Agent

- **Context Awareness**: Before scheduling, always check the user's current schedule using `op: 'events'` for the relevant date range.
- **Source Discovery**: If the user refers to a calendar by name but you don't have the ID, use `op: 'list_calendars'` to find the matching `source` and `id`.
- **Incremental Configuration**: When changing visibility, preserve the existing configuration unless explicitly asked to overwrite it.
- **Timezones**: All dates are handled in `YYYY-MM-DD` format for the `calendar` tool; ensure you are aware of the user's local time context when translating "today" or "tomorrow."
