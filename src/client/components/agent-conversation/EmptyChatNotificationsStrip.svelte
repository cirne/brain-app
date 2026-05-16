<script lang="ts">
  import {
    Bell,
    Mail,
    MessageCircleCheck,
    MessageCircleQuestionMark,
    MessageSquare,
    UserPlus,
    X,
  } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { EmptyChatNotificationsProps } from '@client/lib/agentConversationViewTypes.js'

  let { notifications }: { notifications: EmptyChatNotificationsProps } = $props()

  function iconForSourceKind(kind: string) {
    if (kind === 'mail_notify') return Mail
    if (kind === 'brain_query_grant_received') return UserPlus
    if (kind === 'b2b_inbound_query') return MessageSquare
    if (kind === 'brain_query_question' || kind === 'brain_query_mail')
      return MessageCircleQuestionMark
    if (kind === 'brain_query_reply_sent') return MessageCircleCheck
    return Bell
  }

  const rowBtnClass = cn(
    'notif-row-act inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[inherit] border-none bg-transparent py-2 pr-2 pl-3 text-left text-[0.8125rem] leading-snug text-foreground',
    'transition-[background-color,color] duration-150 ease-out',
    'hover:bg-[color-mix(in_srgb,var(--bg-3)_55%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
    'dark:hover:bg-[color-mix(in_srgb,var(--bg-3)_72%,transparent)]',
  )

  const dismissBtnClass = cn(
    'notif-row-dismiss mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-muted',
    'transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--bg-3)_50%,transparent)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  )
</script>

<div
  class="notification-strip mx-auto w-full max-w-md"
  data-testid="empty-chat-notifications-strip"
  aria-label={$t('chat.emptyState.notificationsHeading')}
>
  <p class="my-2 text-center text-[0.6875rem] font-semibold tracking-[0.06em] text-muted uppercase">
    {$t('chat.emptyState.notificationsHeading')}
  </p>
  <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
    {#each notifications.items as row (row.id)}
      {@const Icon = iconForSourceKind(row.sourceKind)}
      <li
        class={cn(
          'flex min-w-0 flex-row items-stretch gap-0 rounded-md border border-border/60 bg-[color-mix(in_srgb,var(--bg-2)_58%,transparent)]',
          'shadow-[0_1px_0_color-mix(in_srgb,var(--border)_55%,transparent),0_8px_22px_-14px_rgba(0,0,0,0.14)]',
          'dark:border-border/55 dark:bg-[color-mix(in_srgb,var(--bg-3)_42%,transparent)] dark:shadow-[0_1px_0_rgba(255,255,255,0.04),0_10px_28px_-16px_rgba(0,0,0,0.55)]',
        )}
      >
        <button
          type="button"
          class={rowBtnClass}
          data-testid="empty-chat-notif-act"
          onclick={() => notifications.onAct(row)}
        >
          <Icon size={15} strokeWidth={2} class="mt-px shrink-0 text-muted opacity-90" aria-hidden="true" />
          <span class="min-w-0 truncate">
            {#if row.sourceKind === 'brain_query_grant_received'}
              {@const peerHandle = row.kickoffHints.peerHandle?.trim()}
              {#if peerHandle}
                {$t('chat.emptyState.peerSharingSummary', { peerHandle })}
              {:else}
                {$t('chat.emptyState.peerSharingSummaryAnonymous')}
              {/if}
            {:else}
              {row.summaryLine}
            {/if}
          </span>
        </button>
        <button
          type="button"
          class={dismissBtnClass}
          data-testid="empty-chat-notif-dismiss"
          aria-label={$t('chat.emptyState.dismissNotificationAria')}
          onclick={(e) => {
            e.stopPropagation()
            notifications.onDismiss(row.id)
          }}
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </li>
    {/each}
  </ul>
  {#if notifications.hasMore}
    <p class="m-0 mt-2.5 text-left text-xs leading-snug text-muted">
      <span data-testid="empty-chat-notif-overflow">{$t('chat.emptyState.notificationsOverflow')}</span>
    </p>
  {/if}
</div>
