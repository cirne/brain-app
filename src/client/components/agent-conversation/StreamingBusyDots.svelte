<div class="streaming-busy-dots" aria-hidden="true">
  <span></span>
  <span></span>
  <span></span>
</div>

<style>
  .streaming-busy-dots {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .streaming-busy-dots span {
    display: block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    animation: streaming-busy-dot 1.1s ease-in-out infinite;
  }

  .streaming-busy-dots span:nth-child(2) {
    animation-delay: 0.16s;
  }
  .streaming-busy-dots span:nth-child(3) {
    animation-delay: 0.32s;
  }

  @keyframes streaming-busy-dot {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.35;
    }
    50% {
      transform: translateY(-3px);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .streaming-busy-dots span {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
