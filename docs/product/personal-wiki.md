# Personal wiki — product concept

This document is the **user-facing mental model** for what Braintunnel stores in markdown under `WIKI_DIR`: why we call it a **wiki**, how it powers personalization, and how **onboarding** should introduce it. It complements [VISION.md](../VISION.md) (direction) and [OPP-006: Email-bootstrap onboarding](../opportunities/OPP-006-email-bootstrap-onboarding.md) (flow).

---

## What is a wiki? (simple terms)

A **wiki** is a collection of **linked text pages**. Each page is a document you can open, edit, and connect to others—like a very small, personal Wikipedia that lives on your machine (and in your git repo, if you use one).

- **Technically:** Pages are files (here, mostly Markdown); **links** tie topics, people, and projects together so nothing lives in isolation.
- **Culturally:** The same idea powers Wikipedia and countless internal sites—**collaborative knowledge as a graph of pages**. Braintunnel applies that pattern to **one reader: you**.

Users who have never edited Wikipedia still understand “a set of notes that link to each other.” Lead with that; mention Wikipedia only as a **familiar example** of the *shape* (linked articles), not as “you’re contributing to the public web.”

---

## Braintunnel’s angle: your private wiki for your life

Braintunnel **creates and helps you maintain** a **personal, private wiki**—a durable place for what matters: people, projects, decisions, travel, health notes you choose to store, and anything else you want the assistant to remember **accurately**.

- **Private:** Your wiki is yours; it is not a public site. (Deployment details: [ARCHITECTURE.md](../ARCHITECTURE.md).)
- **Grounded:** Email, calendar, and (where enabled) other sources **feed** the wiki; the assistant uses those sources to **summarize and structure**, not to expose raw mail in random places without intent. The wiki is working synthesis, not a substitute for source evidence: when facts may have changed, the assistant should verify against the newest relevant dated source.
- **Compounding:** The value is in the **network** of pages over time—the same insight as a “second brain” or Obsidian-style vault, with Braintunnel doing more of the scaffolding.

**Collaboration (future, not shipped):** Explicit **sharing** of a subtree with **another Braintunnel user** (read-only or read-write)—similar in spirit to sharing a folder elsewhere—is a planned direction (e.g. assistant + travel). Direction is **per-tenant share metadata** (files in each brain home), **server checks on every read**, and optional **symlinks** so tools see shared pages locally; **prefix grants** imply *everything new under that folder* may be visible unless mitigated (confirm-on-write, exclusions, UX). Spec: [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md), [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md), [wiki-directory-sharing](../architecture/wiki-directory-sharing.md).

---

## Why the wiki exists: personalized assistant, not generic chat

A generic model starts every session cold. Braintunnel’s assistant is meant to **read your wiki** (and tools) so answers align with **your** people, projects, and history.

Rough loop:

1. **Capture** — You and Braintunnel add or update pages (onboarding seeds many of them).
2. **Connect** — Wikilinks and structure turn isolated facts into context.
3. **Consult** — The main agent uses `me.md`, people pages, project pages, and the rest when helping you in chat.

So: **the wiki is not the product for its own sake**—it is the **memory and structure** that makes the assistant *yours*. Saying this explicitly in onboarding reduces confusion (“why are there files?”) and sets expectations (“it gets better as the wiki grows”).

---

## Onboarding: teach the model early

Onboarding should not assume the user knows Obsidian, git, or Wikipedia internals. A short, **repeatable** explanation should appear **before or at the start** of “connect email”—not only after pages exist.

**Goals for copy:**

1. **Name the thing:** Braintunnel builds **your personal wiki**—linked pages about your life.
2. **Motivate email/calendar:** Those sources help Braintunnel **populate** the wiki quickly so you are not starting from a blank slate.
3. **Close the loop:** Braintunnel then **uses** that wiki to **become your personalized assistant**—answers and drafts grounded in *your* context.

Optional one-liner for power users: pages live as markdown in a repo you can edit elsewhere; most people never need that detail on day one.

**Where to show it**

- First screen of `/onboarding` (or equivalent): title + 2–4 short paragraphs / bullets.
- First-run **Wiki** UI if opened before seeding completes: same short definition + “your wiki is being built…” progress.
- Slash menu / help: link or tooltip “What’s a wiki?” → short version of this doc or an in-app sheet.

---

## Inline help (copy-paste blocks)

**Short (tooltip or one screen)**

> **Your wiki** is a set of linked notes Braintunnel keeps for you—like a tiny private Wikipedia. Pages connect people, projects, and ideas so the assistant can remember *your* context, not generic guesses.

**Medium (onboarding panel)**

> A **wiki** is a collection of linked text pages. You’ve seen this idea on large public sites like Wikipedia: many articles, each linking to related ones. Braintunnel does the same for **your** life—**your own private wiki**—so everything important lives in one place and the assistant can help using **your** facts, people, and projects. Email and calendar help Braintunnel fill it in; over time, it becomes the backbone of a **personalized** assistant.

**One sentence (empty state)**

> Your wiki is where Braintunnel stores linked notes about your life so answers stay personal and grounded.

---

## Relation to slash skills

User-editable recipes ([OPP-010](../opportunities/OPP-010-user-skills.md)) should align with this vocabulary: **`/wiki`** is a strong primary name for “create, edit, tidy, and restructure wiki content in natural language” ([OPP-011](../opportunities/OPP-011-user-skills-strategy.md)). The inline help above can also appear when the user first invokes `/wiki` or opens the wiki panel.

---

## References

- [VISION.md](../VISION.md) — second brain, compounding value
- [OPP-006: Email-bootstrap onboarding](../opportunities/OPP-006-email-bootstrap-onboarding.md) — concrete steps
- [OPP-011: User skills strategy](../opportunities/OPP-011-user-skills-strategy.md) — `/wiki` and NL-first skills
- [IDEA Wiki sharing with collaborators](../ideas/IDEA-wiki-sharing-collaborators.md) — future optional sharing of wiki subtrees (see “Collaboration (future)” above)
- [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) · [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md) — planned implementation shape (manifests, symlinks, read checks)
