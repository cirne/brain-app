<div class="hub-wiki-about">
  <div class="hub-wiki-about-inner">
    <p class="hub-wiki-about-lead">
      Your <strong>wiki</strong> is a private set of Markdown pages in <strong>your vault</strong> on this Mac. Braintunnel keeps it growing and
      tidy automatically—so answers stay grounded in <em>your</em> world, not a generic model guess.
    </p>

    <h3 class="hub-wiki-about-h">How the continuous loop works</h3>
    <p>
      While Braintunnel is running, the <strong>Your Wiki loop</strong> works in the background. Each lap has two phases:
    </p>
    <ul class="hub-wiki-about-list">
      <li>
        <strong>Enriching</strong> — adds and deepens pages (people, projects, interests) from your mail, profile,
        and public sources. Pages are cross-linked with <span class="kbd">[[wikilinks]]</span>.
      </li>
      <li>
        <strong>Cleaning up</strong> — fixes broken links, checks orphan pages, and updates the index so
        navigation stays coherent.
      </li>
    </ul>
    <p>
      When the wiki looks up-to-date, the loop backs off and waits for new mail or a manual nudge from the
      <strong>Your Wiki</strong> card in Braintunnel Hub before running again.
    </p>

    <h3 class="hub-wiki-about-h">Sources vs. wiki</h3>
    <p>
      Raw material lives in the things you connect: email, documents and folders, calendar, and (when available)
      Messages. Braintunnel searches those directly. The wiki is different — it is your
      <strong>synthesized knowledge base</strong>: names, projects, and context compiled into readable pages. Over
      time it becomes richer and more accurate without duplicating every raw message.
    </p>

    <h3 class="hub-wiki-about-h">You're in control</h3>
    <ul class="hub-wiki-about-list">
      <li>
        <strong>Vault.</strong> Opening Braintunnel on this Mac means unlocking your vault with the password you set at setup.
      </li>
      <li>
        <strong>Pause / Resume.</strong> Open "Your Wiki" from Braintunnel Hub to pause the loop any time.
        Resume always starts a fresh lap.
      </li>
      <li>
        <strong>Edit yourself.</strong> Open pages from hub or chat. The loop picks up your edits and works
        around them.
      </li>
      <li>
        <strong>Move around quickly.</strong> Mention a page with <span class="kbd">@</span> to open it from chat, or
        search when you know the name but not the path.
      </li>
    </ul>

    <p class="hub-wiki-about-foot">
      Think of the wiki as the map of what matters to you: the distilled picture Braintunnel uses alongside live search
      so help stays personal, consistent, and yours.
    </p>
  </div>
</div>

<style>
  .hub-wiki-about {
    padding: 1rem 1.25rem 1.75rem;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .hub-wiki-about-inner {
    max-width: 36rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .hub-wiki-about-lead {
    margin: 0;
    font-size: 1rem;
    line-height: 1.55;
    color: var(--text);
  }

  .hub-wiki-about-h {
    margin: 0.25rem 0 0;
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
  }

  .hub-wiki-about p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text);
  }

  .hub-wiki-about-list {
    margin: 0;
    padding-left: 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text);
  }

  .hub-wiki-about-list li {
    padding-left: 0.15rem;
  }

  .kbd {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.85em;
    padding: 0.08em 0.35em;
    border-radius: 4px;
    background: var(--bg-3);
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }

  .hub-wiki-about-foot {
    margin-top: 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    font-size: 0.875rem !important;
    color: var(--text-2) !important;
    line-height: 1.5 !important;
  }
</style>
