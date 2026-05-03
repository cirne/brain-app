<div
  class="streaming-busy-dots inline-flex items-center gap-1 [&>span]:block [&>span]:h-[5px] [&>span]:w-[5px] [&>span]:rounded-full [&>span]:bg-current [&>span]:[animation:streaming-busy-dot_1.1s_ease-in-out_infinite] [&>span:nth-child(2)]:[animation-delay:0.16s] [&>span:nth-child(3)]:[animation-delay:0.32s] motion-reduce:[&>span]:[animation:none] motion-reduce:[&>span]:opacity-60"
  aria-hidden="true"
>
  <span></span>
  <span></span>
  <span></span>
</div>

<style>
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
</style>
