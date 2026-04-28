<script lang="ts">
  import { tick } from 'svelte'
  import type { SkillMenuItem } from '@client/lib/agentUtils.js'
  import AgentInput from './AgentInput.svelte'
  import ChatComposerAudio from './ChatComposerAudio.svelte'
  import ChatVoicePanel from './ChatVoicePanel.svelte'

  type ComposerMode = 'text' | 'voice'

  let {
    /** When true, show mic and allow switching to the voice panel. */
    voiceEligible = false,
    /** When this key changes, reset to text mode (e.g. active session id). */
    sessionResetKey = '',
    showHearRepliesAudioStrip = false,
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
    showHearRepliesToggle = true,
    onHearRepliesChange,
    holdGated = false,
  }: {
    voiceEligible?: boolean
    sessionResetKey?: string
    showHearRepliesAudioStrip?: boolean
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
    showHearRepliesToggle?: boolean
    onHearRepliesChange: (_value: boolean) => void
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

<div class="unified-chat-composer">
  <div class="composer-input-row">
    <div class="composer-input-shell">
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
  {#if showHearRepliesAudioStrip && composerMode === 'text'}
    <ChatComposerAudio
      {showHearRepliesToggle}
      {hearReplies}
      {onHearRepliesChange}
    />
  {/if}
</div>

<style>
  .unified-chat-composer {
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: 100%;
  }

  .composer-input-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 0 0 6px;
    flex-shrink: 0;
  }

  .composer-input-shell {
    flex: 1;
    min-width: 0;
  }
</style>
