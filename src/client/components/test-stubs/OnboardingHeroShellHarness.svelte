<script lang="ts">
  import OnboardingHeroShell from '../onboarding/OnboardingHeroShell.svelte'
</script>

<OnboardingHeroShell ariaBusy={true}>
  {#snippet children()}
    <p data-testid="hero-body">Hero body</p>
  {/snippet}
</OnboardingHeroShell>
