<script lang="ts">
  import { t } from '@client/lib/i18n/index.js'

  let {
    onOpenEmail: _onOpenEmail,
    onOpenFullInbox: _onOpenFullInbox,
    onSwitchToCalendar: _onSwitchToCalendar,
    onOpenWikiAbout,
    tunnelOutboundEmptyChat = false,
    tunnelOutboundPeer = null,
  }: {
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    /** Opens wiki at vault landing (`index.md` / resolved root), same as the Wiki nav control. */
    onOpenWikiAbout?: () => void
    /** Outbound B2B tunnel: copy targets their Brain, not local wiki/email context. */
    tunnelOutboundEmptyChat?: boolean
    /** Workspace @mention from {@link formatTunnelPeerMention}; null → anonymous tunnel strings. */
    tunnelOutboundPeer?: string | null
  } = $props()

  const atHintParts = $derived($t('chat.emptyState.atHint').split('@'))
</script>

<!-- Optional email & requests strip renders in AgentChat above this hero; keep copy compact so it centers with the composer. -->
<div class="box-border flex w-full flex-col items-center pb-2">
  <div class="max-w-md text-balance text-center text-sm leading-relaxed text-muted">
    {#if tunnelOutboundEmptyChat}
      {#if tunnelOutboundPeer}
        <p>{$t('chat.emptyState.tunnelOutboundPromptNamed', { peer: tunnelOutboundPeer })}</p>
        <p class="mt-1.5 text-xs opacity-70">
          {$t('chat.emptyState.tunnelOutboundHintNamed')}
        </p>
      {:else}
        <p>{$t('chat.emptyState.tunnelOutboundPromptAnonymous')}</p>
        <p class="mt-1.5 text-xs opacity-70">
          {$t('chat.emptyState.tunnelOutboundHintAnonymous')}
        </p>
      {/if}
    {:else}
      <p>{$t('chat.emptyState.prompt')}</p>
      <p class="mt-1.5 text-xs opacity-70">
        {#if atHintParts.length === 2}
          {atHintParts[0]}<kbd
            class="inline-flex size-5 items-center justify-center rounded-sm border border-border bg-surface-3 p-0 font-[inherit] text-xs leading-none shadow-[0_1px_0_color-mix(in_srgb,var(--border)_40%,transparent)]"
          >@</kbd>{atHintParts[1]}
        {:else}
          {$t('chat.emptyState.atHint')} <kbd
            class="inline-flex size-5 items-center justify-center rounded-sm border border-border bg-surface-3 p-0 font-[inherit] text-xs leading-none shadow-[0_1px_0_color-mix(in_srgb,var(--border)_40%,transparent)]"
          >@</kbd>
        {/if}
        {#if onOpenWikiAbout}
          <button
            type="button"
            class="wiki-about-link m-0 cursor-pointer border-none bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] text-accent underline underline-offset-2 [text-decoration-color:color-mix(in_srgb,var(--accent)_35%,transparent)] hover:[text-decoration-color:var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onclick={onOpenWikiAbout}
          >{$t('chat.emptyState.yourWiki')}</button>.
        {:else}
          {$t('chat.emptyState.yourWiki')}.
        {/if}
      </p>
    {/if}
  </div>
</div>
