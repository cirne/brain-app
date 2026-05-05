# BUG-044: Wiki primary crumbs not collapsing when space is insufficient

## Status

**Open**

## Summary

The `CollapsibleBreadcrumb` component used in the wiki primary bar (`WikiPrimaryBarCrumbs.svelte`) fails to automatically collapse into a dropdown menu when the path is too long for the available width. Instead of "prolapsing" into a folder icon with a dropdown, it keeps all segments visible, leading to layout breakage or unreadable truncated labels (e.g., `W.. / My .. / tr...`).

## Repro

1. Open a wiki page with a deep path (e.g., `Wiki / My Wiki / travel / deep / folder / page.md`).
2. Resize the browser window or sidebar to be narrow.
3. Observe that the breadcrumb segments do not collapse into a `...` or folder icon, but instead stay in a single row, often causing the labels to shrink to unreadable ellipses.

## Desired Behavior

When the breadcrumb container overflows its client width:

1. It should switch to a "collapsed" mode.
2. The collapsed mode should show a folder icon (or `...`) followed by the current page name.
3. Clicking the folder icon should open a dropdown menu listing the parent directories for navigation.

## Investigation Notes

- The `CollapsibleBreadcrumb.svelte` component has a `ResizeObserver` and an `$effect` to check for overflow (`containerEl.scrollWidth > containerEl.clientWidth`).
- Recent fixes improved the flex-shrink behavior so that prefix labels stay readable while the tail truncates, but the transition to the `isOverflowing` state (which triggers the dropdown UI) is not firing reliably or correctly detecting the need to collapse.
- The `isOverflowing` state is what controls the `{#if isOverflowing && hasCollapsibleItems}` block in `CollapsibleBreadcrumb.svelte`.

## Fix Direction

- Audit the `checkOverflow` logic in `CollapsibleBreadcrumb.svelte`.
- Ensure the `containerEl` is correctly sized and that `scrollWidth` vs `clientWidth` is a reliable indicator in the `wiki-primary-bar` flex context.
- Verify that the `ResizeObserver` is observing the correct element and that the reactive dependencies in the `$effect` are sufficient to trigger a re-check when the path changes.

