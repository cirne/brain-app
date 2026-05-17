<script lang="ts">
  import googleG from '@client/assets/brands/google-g.svg'
  import slackMark from '@client/assets/brands/slack-mark.svg'

  export type ConnectionBrand = 'google' | 'slack'

  let { brand, size = 16 }: { brand: ConnectionBrand; size?: number } = $props()

  const src = $derived(brand === 'google' ? googleG : slackMark)
</script>

<img
  {src}
  alt=""
  width={size}
  height={size}
  class="connection-brand-logo shrink-0 object-contain"
  aria-hidden="true"
/>
