<script lang="ts">
  /** Records SlideOver shell props for AssistantSlideOver tests (no wiki/inbox UI). */
  let props = $props()

  export function closeAnimated() {}
</script>

<div
  data-testid="slide-over-props-stub"
  data-mobile-panel={props.mobilePanel ?? false}
  data-detail-fullscreen={props.detailFullscreen ?? false}
></div>
