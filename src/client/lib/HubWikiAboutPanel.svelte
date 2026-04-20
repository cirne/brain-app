<div class="hub-wiki-about">
  <div class="hub-wiki-about-inner">
    <p class="hub-wiki-about-lead">
      Your <strong>wiki</strong> is a private set of Markdown pages stored on this Mac. It is the layer Brain keeps
      up to date so answers stay grounded in <em>your</em> world—not a generic model guess.
    </p>

    <h3 class="hub-wiki-about-h">Sources vs. wiki</h3>
    <p>
      Raw material lives in the things you connect: email, documents and folders in your search index, calendar,
      and (when available) Messages. Brain can read and search those sources directly.
    </p>
    <p>
      The wiki is different: it is your <strong>synthesized knowledge base</strong>—names, projects, recurring
      context, and relationships pulled together into pages you can read and edit. Over time, as more mail and files
      land in the index and you work with Brain in chat, the wiki usually becomes <strong>deeper and more
        accurate</strong> without turning into a dump of every raw message.
    </p>

    <h3 class="hub-wiki-about-h">You’re in control</h3>
    <ul class="hub-wiki-about-list">
      <li>
        <strong>Edit yourself.</strong> Open pages from the hub or chat, or use <span class="kbd">/wiki</span> to
        jump into the wiki workflow when you want to write or fix something by hand.
      </li>
      <li>
        <strong>Let Brain extend it.</strong> Background wiki expansion and ordinary chat can add or refine pages
        when that helps—always anchored on evidence from your sources, not invented detail.
      </li>
      <li>
        <strong>Move around quickly.</strong> Mention a page with <span class="kbd">@</span> to open it from chat, or
        search when you know the name but not the path.
      </li>
    </ul>

    <p class="hub-wiki-about-foot">
      Think of the wiki as the map of what matters to you: the distilled picture Brain uses alongside live search
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
