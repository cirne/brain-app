<script lang="ts">
  import { tick } from 'svelte'
  import type { SkillMenuItem } from '@client/lib/agentUtils.js'
  import AgentInput from '@tw-components/AgentInput.svelte'
  import ChatVoicePanel from '@tw-components/ChatVoicePanel.svelte'

  type ComposerMode = 'text' | 'voice'

  let {
    /** When true, show mic and allow switching to the voice panel. */
    voiceEligible = false,
    /** When this key changes, reset to text mode (e.g. switching chats). Stable across pending→server session migration via SessionState.composerResetKey. */
    sessionResetKey = '',
    placeholder = 'What do you need to know or get done?',
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
  <div class="composer-input-row flex w-full min-w-0 box-border shrink-0 flex-row items-start pb-1.5">
    <div class="composer-input-shell flex-1 min-w-0">
      {#if voiceEligible && composerMode === 'voice'}
        <ChatVoicePanel
          layout="composer-flow"
          disabled={streaming}
          holdGated={holdGated}
          {hearReplies}
          autoStartRecording={true}
          onTranscribe={onTranscribe}
          onExitVoiceMode={exitVoiceMode}
        />
      {:else}
        <AgentInput
          bind:this={inputRef}
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
          showVoiceEntry={voiceEligible}
          onVoiceEntry={openVoiceMode}
          voiceEntryDisabled={streaming}
        />
      {/if}
    </div>
  </div>
</div>
