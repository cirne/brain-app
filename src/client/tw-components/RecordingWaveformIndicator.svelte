<script lang="ts">
  /**
   * Decorative “live capture” feedback while recording — not level-accurate (no AnalyserNode here).
   * Sits left of the send-style primary in {@link ChatVoicePanel}.
   */
  const BARS = 5
  const bars = Array.from({ length: BARS }, (_, i) => i)
</script>

<div
  class="voice-waveform box-border flex h-9 min-w-[44px] shrink-0 items-center justify-center gap-[3px] px-0.5"
  aria-hidden="true"
>
  {#each bars as i (i)}
    <span class="voice-waveform-bar" style="animation-delay: {i * 0.1}s"></span>
  {/each}
</div>

<style>
  /* Bar styling + keyframes stay scoped — animation-delay is set inline per bar. */
  .voice-waveform-bar {
    width: 3px;
    height: 8px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--accent, #6366f1) 75%, var(--text) 25%);
    opacity: 0.55;
    transform-origin: center bottom;
    animation: voice-waveform-bob 0.55s ease-in-out infinite alternate;
  }

  @keyframes voice-waveform-bob {
    0% {
      transform: scaleY(0.45);
      opacity: 0.4;
    }
    100% {
      transform: scaleY(1.65);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-waveform-bar {
      animation: none;
      transform: scaleY(1);
      opacity: 0.75;
    }
  }
</style>
