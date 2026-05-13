<script lang="ts">
  import type { ChatMessage } from '@client/lib/agentUtils.js'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import {
    chatMessagePlainText,
    defaultWikiPath,
    messagesToMarkdown,
    saveToWiki,
  } from '@client/lib/tunnels/saveTunnelToWiki.js'

  let {
    open,
    onDismiss,
    messages,
    peerLabel,
    sessionId,
    onNavigateWiki,
  }: {
    open: boolean
    onDismiss: () => void
    messages: ChatMessage[]
    peerLabel: string
    sessionId: string
    onNavigateWiki?: (_path: string) => void
  } = $props()

  let dialogEl = $state<HTMLDialogElement | null>(null)
  let wikiPath = $state('')
  let noteTitle = $state('')
  let includeProvenance = $state(true)
  let openAfterSave = $state(true)
  let saving = $state(false)
  let error = $state<string | null>(null)

  let wasOpen = $state(false)

  function firstAssistantSnippet(): string {
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const txt = chatMessagePlainText(m)
      const line = txt.split('\n')[0]?.trim() ?? ''
      if (line) return line
    }
    return ''
  }

  $effect(() => {
    if (open && !wasOpen) {
      wikiPath = defaultWikiPath({
        peerLabel,
        sessionId,
        firstLine: firstAssistantSnippet(),
      })
      noteTitle = ''
      includeProvenance = true
      openAfterSave = true
      error = null
      saving = false
    }
    wasOpen = open
  })

  $effect(() => {
    const el = dialogEl
    if (!el || !open) return

    function openModal() {
      if (typeof el!.showModal === 'function') {
        try {
          el!.showModal()
          return
        } catch {
          /* strict hosts */
        }
      }
      el!.setAttribute('open', '')
    }

    if (!el.open) openModal()
  })

  function onDialogCancel(e: Event) {
    e.preventDefault()
    if (!saving) onDismiss()
  }

  function onBackdropClick() {
    if (!saving) onDismiss()
  }

  function onPanelClick(e: MouseEvent) {
    e.stopPropagation()
  }

  const btnBase = 'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 [font:inherit]'
  const btnNeutral =
    'rounded-md border border-border bg-surface-3 px-3 py-[0.4rem] text-xs font-medium leading-tight text-foreground transition-colors hover:bg-surface-2'
  const btnPrimary =
    'rounded-md border border-accent bg-accent px-3 py-[0.4rem] text-xs font-medium leading-tight text-white transition-colors hover:opacity-90'

  async function onSave() {
    if (saving) return
    saving = true
    error = null
    try {
      const md = messagesToMarkdown(messages, {
        title: noteTitle.trim() || undefined,
        includeProvenance,
        peerLabel,
        sessionId,
      })
      const { path } = await saveToWiki({ path: wikiPath.trim(), markdown: md })
      onDismiss()
      if (openAfterSave) onNavigateWiki?.(path)
    } catch (e) {
      error = e instanceof Error ? e.message : $t('chat.saveToWiki.error')
    } finally {
      saving = false
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <dialog
    bind:this={dialogEl}
    class="stw-modal fixed inset-0 m-0 box-border flex h-full max-h-screen w-full max-w-screen items-center justify-center overflow-hidden border-none bg-transparent p-4"
    aria-modal="true"
    aria-labelledby="save-tunnel-wiki-title"
    data-testid="save-tunnel-wiki-modal"
    oncancel={onDialogCancel}
  >
    <div
      class="absolute inset-0 z-0 cursor-pointer bg-black/45"
      role="presentation"
      onclick={onBackdropClick}
    ></div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'relative z-[1] box-border w-full max-w-md cursor-auto border border-border bg-surface px-4 pt-4 pb-3 [box-shadow:0_12px_40px_rgba(0,0,0,0.25)]',
      )}
      onclick={onPanelClick}
    >
      <h2 id="save-tunnel-wiki-title" class="m-0 text-sm font-semibold text-foreground">
        {$t('chat.saveToWiki.title')}
      </h2>
      <div class="mt-3 flex flex-col gap-2 text-xs">
        <label class="flex flex-col gap-1">
          <span class="font-medium text-muted">{$t('chat.saveToWiki.pathLabel')}</span>
          <input
            bind:value={wikiPath}
            class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-foreground"
            autocomplete="off"
            data-testid="save-tunnel-wiki-path"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-medium text-muted">{$t('chat.saveToWiki.titleLabel')}</span>
          <input
            bind:value={noteTitle}
            class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-foreground"
            placeholder={$t('chat.saveToWiki.titlePlaceholder')}
            autocomplete="off"
            data-testid="save-tunnel-wiki-note-title"
          />
        </label>
        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" bind:checked={includeProvenance} data-testid="save-tunnel-wiki-provenance" />
          <span>{$t('chat.saveToWiki.provenance')}</span>
        </label>
        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" bind:checked={openAfterSave} data-testid="save-tunnel-wiki-open-after" />
          <span>{$t('chat.saveToWiki.openAfter')}</span>
        </label>
        {#if error}
          <p class="m-0 text-danger" role="alert" data-testid="save-tunnel-wiki-error">{error}</p>
        {/if}
      </div>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" class={cn(btnBase, btnNeutral)} disabled={saving} onclick={() => onDismiss()}>
          {$t('chat.saveToWiki.cancel')}
        </button>
        <button
          type="button"
          class={cn(btnBase, btnPrimary)}
          disabled={saving || wikiPath.trim().length === 0}
          data-testid="save-tunnel-wiki-submit"
          onclick={() => void onSave()}
        >
          {saving ? $t('chat.saveToWiki.saving') : $t('chat.saveToWiki.save')}
        </button>
      </div>
    </div>
  </dialog>
{/if}

<style>
  .stw-modal::backdrop {
    background: transparent;
    pointer-events: none;
  }
</style>
