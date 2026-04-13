<script lang="ts">
  import AgentDrawer from './AgentDrawer.svelte'
  import type { SurfaceContext } from '../router.js'

  type Props = {
    drawerOpen: boolean
    agentPanelWidth: number
    agentPanelResizing: boolean
    agentContext: SurfaceContext
    onResizePointerDown: (_e: PointerEvent) => void
    onToggle: () => void
    onOpenWiki: (_path: string) => void
    onSwitchToCalendar: (_date: string) => void
  }

  let {
    drawerOpen,
    agentPanelWidth,
    agentPanelResizing,
    agentContext,
    onResizePointerDown,
    onToggle,
    onOpenWiki,
    onSwitchToCalendar,
  }: Props = $props()

  let drawer = $state<AgentDrawer | undefined>()
  export function newChat() {
    drawer?.newChat()
  }
</script>

<div
  class="agent-panel"
  class:open={drawerOpen}
  class:resizing={agentPanelResizing}
  style:--panel-w="{agentPanelWidth}px"
>
  <button
    type="button"
    class="agent-resize-handle"
    aria-label="Resize chat panel"
    title="Drag to resize"
    onpointerdown={onResizePointerDown}
  >
    <span class="agent-resize-grip" aria-hidden="true"></span>
  </button>
  <AgentDrawer
    bind:this={drawer}
    context={agentContext}
    open={drawerOpen}
    onToggle={onToggle}
    onOpenWiki={onOpenWiki}
    onSwitchToCalendar={onSwitchToCalendar}
  />
</div>

<style>
  .agent-panel {
    --panel-w: 420px;
    position: relative;
    z-index: 1;
    width: var(--panel-w);
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    /* allow .agent-resize-handle (negative margin) to paint over .surface — was clipping the grip */
    overflow: visible;
  }

  .agent-resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    /* Wider than the 1px panel border so the grip straddles the split */
    width: 16px;
    margin-left: -8px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
    border: none;
    padding: 0;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .agent-resize-handle:hover .agent-resize-grip,
  .agent-resize-handle:focus-visible .agent-resize-grip {
    opacity: 0.95;
  }

  /* Visible grip: 8×30px, sits across the border line */
  .agent-resize-grip {
    width: 8px;
    height: 30px;
    border-radius: 4px;
    box-sizing: border-box;
    opacity: 0.45;
    background-color: var(--text-2);
    background-image: repeating-linear-gradient(
      180deg,
      transparent 0 4px,
      rgba(0, 0, 0, 0.1) 4px 5px
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  }

  .agent-panel.resizing .agent-resize-grip {
    opacity: 1;
  }

  /* Small screens: collapsible bottom sheet */
  @media (max-width: 767px) {
    .agent-resize-handle {
      display: none;
    }

    .agent-panel {
      position: fixed;
      bottom: 0;
      left: 5vw;
      width: 90vw;
      height: 44px; /* collapsed: just the header */
      border-left: none;
      border-top: none;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.35);
      z-index: 50;
      overflow: hidden;
      transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .agent-panel.open {
      height: 80vh;
    }
  }
</style>
