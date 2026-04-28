/**
 * OPP-055: route voice transcript — auto-send when composer empty, append when user has a draft.
 */
export function applyVoiceTranscriptToChat(
  transcript: string,
  composerDraft: string,
  send: (text: string) => void | Promise<void>,
  appendToComposer: (text: string) => void,
): void {
  if (!composerDraft.trim()) {
    void send(transcript)
  } else {
    appendToComposer(transcript)
  }
}
