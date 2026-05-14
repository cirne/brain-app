# BUG-041: Doc / wiki viewer — top chrome and L2 navigation overload (especially mobile)

**Status:** Open — superseded by [archived OPP-092](../opportunities/archive/OPP-092-mobile-navigation-ia-rethink.md) (mobile navigation IA rethink). This bug is the symptom; OPP-092 is the redesign that fixes it.
**Severity:** P2 (readability + primary reading surface; mobile is cramped)
**Area:** Wiki / document viewer shell, responsive layout

---

## Symptoms

- **Top of the doc viewer** feels crowded with **too many buttons** and affordances competing for space.
- **Second-level navigation** (breadcrumbs, tabs, or sibling controls around the reader) does not degrade gracefully on **narrow viewports**; the layout reads as **desktop-first** and becomes hard to scan or tap on **mobile WebKit**.

---

## Expected

- A **clear visual hierarchy** on small screens: primary actions visible, secondary actions in overflow or a single consolidated control.
- **L2 nav** (section or doc switching) should remain usable with thumb reach and **without horizontal clutter** from duplicated chrome.

---

## Notes / direction

- This is an **information architecture + responsive layout** pass, not a single-button tweak.
- Consider **one** overflow pattern (e.g. “More” / bottom sheet on mobile) and **fewer** persistent icon rows in the reader header.