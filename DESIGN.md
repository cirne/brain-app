---
version: alpha
name: Braintunnel
description: A warm personal knowledge workbench for chat, wiki, inbox, and agentic tools.
colors:
  primary: "#586a55"
  on-primary: "#ffffff"
  surface: "#fbfaf7"
  surface-1: "#fbfaf7"
  surface-2: "#f2eee8"
  surface-3: "#e7dfd5"
  border: "#d8d0c4"
  foreground: "#18130e"
  muted: "#6f6458"
  accent-dim: "#e4e8dc"
  danger: "#b94b4b"
  on-danger: "#ffffff"
  success: "#2f7f55"
  on-success: "#ffffff"
typography:
  display:
    fontFamily: ui-serif, Georgia, "Times New Roman", serif
    fontSize: 2.25rem
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  heading:
    fontFamily: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1.125rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
rounded:
  sm: 6px
  md: 10px
  lg: 16px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  app-canvas:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  side-rail:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  workspace-panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  nested-well:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
  divider:
    backgroundColor: "{colors.border}"
    textColor: "{colors.foreground}"
    size: 1px
  primary-action:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 10px
  quiet-action:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 10px
  destructive-action:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 10px
  positive-status:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-success}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
---

## Overview

Braintunnel should feel like a personal knowledge workbench: quiet, durable, and slightly editorial. It is not a blank chatbot and not an IDE clone. The product mixes chat, wiki, inbox, and local tools, so the visual system should make panes feel like calm working surfaces rather than generic gray chrome.

The identity is warm neutral surfaces, ink-like foreground text, and a single muted sage action color. The palette should imply local files, notes, and continuity; avoid pure black/white UI unless a contrast requirement forces it. The interface can stay dense, but it should feel composed, not skeletal.

## Colors

The runtime source of truth remains `src/client/style.css`. This file documents the intended values and should be kept aligned with the `:root` variables and Tailwind v4 `@theme` aliases.

- `surface`, `surface-1`, `surface-2`, and `surface-3` map to the Tailwind utilities `bg-surface`, `bg-surface-1`, `bg-surface-2`, and `bg-surface-3`.
- `foreground`, `muted`, `border`, `primary`, `accent-dim`, `danger`, and `success` map to the existing text, border, and status utilities.
- `on-primary` maps to `text-accent-foreground` and should be used for text or icons inside filled accent controls.
- `primary` is the only strong interaction color. Use it for links, focused calls to action, selected states, and meaningful progress. Do not introduce a second saturated accent for routine UI.
- `accent-dim` is a soft selected or hover wash. It should never be the only state indicator when text contrast or focus visibility matters.

Dark mode keeps the same relationships with lower luminance values:

- `surface`: `#11100d`
- `surface-2`: `#1d1a16`
- `surface-3`: `#2a251f`
- `border`: `#3b342c`
- `foreground`: `#f0ebe4`
- `muted`: `#b3a797`
- `primary`: `#b8c9ae`
- `on-primary`: `#11100d`
- `accent-dim`: `#253126`

## Typography

Use the system sans stack for most UI so Braintunnel stays native on macOS and fast in the bundled desktop app. The optional serif display token is for sparse, high-level product surfaces: onboarding hero copy, empty-state titles, or a future home/dashboard. Do not use it inside dense chat transcripts, inbox threads, code blocks, or tool logs.

Headings should be compact and slightly tighter than body text. Labels are confident but not all-caps by default; they should read as UI affordances rather than terminal chrome.

## Layout

The product is pane-based: rail, transcript, wiki, inbox, and slide-over surfaces. Use visible but low-contrast boundaries, steady gutters, and restrained radius. Keep the existing app-level layout variables in `src/client/style.css` (`--tab-h`, `--pane-header-px`, `--sidebar-w`, `--chat-column-max`) as implementation tokens; they are intentionally more concrete than this DESIGN.md schema.

Chat-only reading width should stay centered and readable. Dense side panels may be compact, but the primary reading pane should keep enough margin to feel like a document surface.

## Elevation & Depth

Prefer layered surfaces and borders over shadows. Braintunnel should feel local and grounded, not like floating web cards. Use `surface-2` for rails and bars, `surface-3` for nested wells, chips, and hover states, and `border` for pane boundaries. Reserve shadows for transient overlays where the layer relationship would otherwise be ambiguous.

## Shapes

Use modest radii. Controls can be slightly rounded, but large pill shapes should be rare because they make the app feel like a generic assistant shell. Panels and wells may use the medium radius when they contain grouped information.

## Components

Primary actions use `primary` on `on-primary`. In code, prefer the shared `.bt-btn` plus `.bt-btn-primary`, `.bt-btn-secondary`, or `.bt-btn-danger` classes before writing panel-local button recipes. Secondary or selected actions use `accent-dim` with `primary` text. Destructive and success states use their named semantic colors and should not borrow the primary accent.

Agent, wiki, and inbox surfaces should use the same neutral scale so switching sections does not feel like switching products. Component-specific styling is welcome when it improves recognition, but it must still resolve back to these tokens.

## Do's and Don'ts

- Do use warm neutrals, ink foregrounds, and muted sage action states to distinguish Braintunnel from default chatbot palettes.
- Do use semantic Tailwind utilities from `@theme` before raw hex values.
- Do keep dark mode as a first-class palette, even though the current DESIGN.md YAML records the light palette.
- Do not paste raw SVG icons or introduce one-off icon treatments; use Lucide components and existing icon guidance.
- Do not add extra brand colors for ordinary UI states.
- Do not replace `src/client/style.css` with generated output unless the export workflow is explicitly adopted.
