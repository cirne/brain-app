# BUG-044: Wiki primary crumbs not collapsing when space is insufficient

**Status:** Fixed (2026-05-06)

## Historical summary

Breadcrumbs tried to infer overflow with `ResizeObserver` and toggle between an inline strip and a folder dropdown; detection was flaky and prefixes still cramped the bar.

## Fix

Dropped dynamic layout switching. Whenever the path has more than one segment, `CollapsibleBreadcrumb` **always** uses the compact layout: folder button with **Show full path** → portal menu listing parents, plus the current leaf in the primary row. Removed `ResizeObserver`, full inline strip markup, and related state from `CollapsibleBreadcrumb.svelte`.

See archived narrative in git history prior to archive for original repro notes.
