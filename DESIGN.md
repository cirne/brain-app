---
version: alpha
name: Braintunnel
description: A local-first console for chat, wiki, inbox, and agents—Neo’s desk, not a stock chatbot skin.
colors:
  primary: "#146c32"
  on-primary: "#f7f7f4"
  surface: "#f0efeb"
  surface-1: "#f0efeb"
  surface-2: "#e3e2db"
  surface-3: "#d4d3ca"
  border: "#8a9582"
  foreground: "#0c140d"
  muted: "#4a5648"
  accent-dim: "#d5dcd4"
  danger: "#b91c1c"
  on-danger: "#fef2f2"
  success: "#0d5c3d"
  on-success: "#f0f4f1"
typography:
  display:
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: 2.125rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading:
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
rounded:
  sm: 2px
  md: 4px
  lg: 8px
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

Braintunnel should read as **a personal terminal into your own stack**: phosphor green on deep void when the system is “awake,” and a **construct** in light mode—**warm neutral paper** (not green-tinted chrome) with **forest type** and **one strong accent**—still unmistakably “code that chose you,” not pastel SaaS.

The identity is **green-on-dark as default hero**, **near-neutral light surfaces + deep green text** (mint washes only in tiny accent-dim hits), and constrained neutrals so chat, wiki, and inbox stay one product. Avoid rainbow accents; reds are for errors and rare warnings only.

## Light mode (“the construct”)

Yes—the app ships **light as default** in CSS (`:root`), then follows **`prefers-color-scheme: dark`** for the void palette. The light program reads as **terminal paper**: warm gray-beige surfaces, muted olive-gray borders, and **forest / phosphor green** for type and actions—not mint or seafoam backgrounds.

## Colors

The runtime source of truth remains `src/client/style.css`. This file documents the intended values and should be kept aligned with the `:root` variables and Tailwind v4 `@theme` aliases.

- `rounded.sm` / `md` / `lg` map to `--radius-sm` / `--radius-md` / `--radius-lg` on `:root`. Tailwind utilities (`rounded-sm`, etc.) compile to `border-radius: var(--radius-*)`, so one edit to those variables rethemes every usage.
- `surface`, `surface-1`, `surface-2`, and `surface-3` map to the Tailwind utilities `bg-surface`, `bg-surface-1`, `bg-surface-2`, and `bg-surface-3`.
- `foreground`, `muted`, `border`, `primary`, `accent-dim`, `danger`, and `success` map to the existing text, border, and status utilities.
- `on-primary` maps to `text-accent-foreground` and should be used for text or icons inside filled accent controls.
- `primary` is the main interaction color (forest / phosphor family, not teal mint). Use it for links, primary buttons, selection, and progress—not a second saturated brand hue.
- `accent-dim` is a soft wash for hover/selected quiet controls; don’t rely on it alone when contrast or focus must be obvious.

**Dark mode** (system preference): lower luminance, yellower phosphor (less teal than emerald):

- `surface`: `#020403`
- `surface-2`: `#060b06`
- `surface-3`: `#0d150d`
- `border`: `#1a3520`
- `foreground`: `#a0e8a8`
- `muted`: `#5eb86a`
- `primary`: `#39ff88`
- `on-primary`: `#020805`
- `accent-dim`: `#0a1f0f`

Pure `#00FF41` is a fine **marketing / decorative** reference; UI text and fills should stay slightly desaturated for long-session reading and WCAG-ish contrast on variable displays.

## Typography

**IBM Plex** is a type *family*, not one font: **IBM Plex Sans** is proportional (normal UI sans); **IBM Plex Mono** is **monospaced** (fixed column width, terminal-like). This product uses **Plex Mono as the default UI face** everywhere `font-family` inherits from `:root`, so chat, rails, and wiki chrome read as a console. Only `pre` / code / file views should force a different stack when needed.

Google Fonts loads **IBM Plex Mono** only in `src/client/style.css`. `--font-mono` is the primary stack; `--font-sans` is a system sans escape hatch (not loaded as Plex Sans anymore).

`--font-sans` and `--font-mono` on `:root` are the implementation hooks; prefer `font-family: inherit` on form controls so they match the page.

## Layout

Pane-based: rail, transcript, wiki, inbox, slide-overs. Prefer **visible borders** over heavy shadows; the Matrix read is **grid and glow-subtle**, not stacked cards. Keep app layout variables in `src/client/style.css` (`--tab-h`, `--pane-header-px`, `--sidebar-w`, `--chat-column-max`) as implementation tokens.

## Elevation & Depth

Layer **surface steps** and **1px borders**. Reserve stronger shadow for overlays and modals. In dark mode, a hint of **green inner/contrast** on borders reads more “CRT scan” than flat gray; avoid large blurred halos unless a specific component already uses them.

## Shapes

**Tight terminal radii** (`sm` / `md` / `lg` above): controls and panels read almost square, not SaaS-pill. Composer shell and quick-reply chips use **`rounded-sm` / `rounded-md`** (not `rounded-full`). Reserve **`rounded-full`** for spinners, switch thumbs, and true circular affordances.

## Components

Primary actions: `primary` fill with `on-primary`. Prefer shared `.bt-btn` variants before one-off buttons. Secondary: `accent-dim` with `primary` text. Destructive and success use semantic reds/greens and should not steal the main accent for routine UI.

## Do's and Don'ts

- Do keep **one green story** across agent, wiki, and mail surfaces.
- Do use semantic Tailwind utilities from `@theme` before raw hex.
- Do treat **dark mode as first-class** (system); light is the alternate “construct,” not an afterthought.
- Do not paste raw SVG icons; use Lucide per project guidance.
- Do not add extra brand colors for ordinary states.
- Do not replace `src/client/style.css` with generated output unless the export workflow is explicitly adopted.
