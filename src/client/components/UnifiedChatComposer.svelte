<script lang="ts">
  import { tick } from 'svelte'
  import type { SkillMenuItem } from '@client/lib/agentUtils.js'
  import { t } from '@client/lib/i18n/index.js'
  import AgentInput from '@components/AgentInput.svelte'
  import ChatVoicePanel from '@components/ChatVoicePanel.svelte'

  type ComposerMode = 'text' | 'voice'

  let {
    /** When true, show mic and allow switching to the voice panel. */
    voiceEligible = false,
    /** When this key changes, reset to text mode (e.g. switching chats). Stable across pending→server session migration via SessionState.composerResetKey. */
    sessionResetKey = '',
    placeholder = $t('chat.input.placeholder'),
    streaming = false,
    queuedMessages = [] as string[],
    wikiFiles = [] as string[],
    skills = [] as SkillMenuItem[],
    transparentSurround = false,
    onNewChat = undefined as (() => void) | undefined,
    onSend: onSendMessage,
    onStop = undefined as (() => void) | undefined,
    onDraftChange = undefined as ((_text: string) => void) | undefined,
    onTranscribe,
    onRequestFocusText = undefined as (() => void) | undefined,
    hearReplies = false,
    holdGated = false,
    /** When true, text field is disabled (e.g. long-running secondary action — not streaming). */
    inputDisabled = false,
    /** False for embedded composers (e.g. B2B review) so primary surface keeps focus on mount. */
    autoFocusInputOnMount = true,
  }: {
    voiceEligible?: boolean
    sessionResetKey?: string
    placeholder?: string
    streaming?: boolean
    queuedMessages?: string[]
    wikiFiles?: string[]
    skills?: SkillMenuItem[]
    transparentSurround?: boolean
    onNewChat?: () => void
    onSend: (_text: string) => void | Promise<void>
    onStop?: () => void
    onDraftChange?: (_text: string) => void
    onTranscribe: (_text: string) => void
    onRequestFocusText?: () => void
    hearReplies?: boolean
    holdGated?: boolean
    inputDisabled?: boolean
    autoFocusInputOnMount?: boolean
  } = $props()

  let composerMode = $state<ComposerMode>('text')
  let inputRef = $state<ReturnType<typeof AgentInput> | undefined>(undefined)

  $effect(() => {
    void sessionResetKey
    composerMode = 'text'
  })

  $effect(() => {
    if (!voiceEligible && composerMode === 'voice') {
      composerMode = 'text'
    }
  })

  function openVoiceMode() {
    if (!voiceEligible || streaming) return
    composerMode = 'voice'
  }

  function exitVoiceMode() {
    composerMode = 'text'
    onRequestFocusText?.()
  }

  /** @public */
  export function focus() {
    if (composerMode === 'voice') {
      composerMode = 'text'
    }
    void tick().then(() => inputRef?.focus())
  }

  /** @public */
  export function appendText(text: string) {
    if (!text) return
    if (composerMode === 'voice') {
      composerMode = 'text'
      void tick().then(() => inputRef?.appendText(text))
      return
    }
    inputRef?.appendText(text)
  }
</script>

<div class="unified-chat-composer flex w-full min-w-0 flex-col">
  <div class="composer-input-row flex w-full min-w-0 box-border shrink-0 flex-row items-start pb-0.5">
    <div class="composer-input-shell flex-1 min-w-0">
      {#if voiceEligible && composerMode === 'voice'}
        <div
          class="input-shell flex flex-1 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface focus-within:border-accent"
        >
          <ChatVoicePanel
            layout="composer-flow"
            disabled={streaming}
            holdGated={holdGated}
            {hearReplies}
            autoStartRecording={true}
            onTranscribe={onTranscribe}
            onExitVoiceMode={exitVoiceMode}
          />
        </div>
      {:else}
        <AgentInput
          bind:this={inputRef}
          disabled={inputDisabled}
          {placeholder}
          {streaming}
          {queuedMessages}
          {wikiFiles}
          {skills}
          {transparentSurround}
          {onNewChat}
          onSend={onSendMessage}
          {onStop}
          {onDraftChange}
          autoFocusOnMount={autoFocusInputOnMount}
          showVoiceEntry={voiceEligible}
          onVoiceEntry={openVoiceMode}
          voiceEntryDisabled={streaming}
        />
      {/if}
    </div>
  </div>
</div>
