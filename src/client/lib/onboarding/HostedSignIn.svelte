<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  function continueWithGoogle() {
    window.location.href = '/api/oauth/google/start'
  }
</script>

<div class="hosted-signin-shell">
  <OnboardingHeroShell>
    <header class="ob-stacked-hero-lead" aria-labelledby="hosted-signin-title">
      <div class="ob-stacked-hero-lead-icon" aria-hidden="true">
        <Lock size={20} strokeWidth={2} />
      </div>
      <span class="ob-kicker">Braintunnel</span>
      <h1 id="hosted-signin-title" class="ob-headline">Sign in</h1>
      <p class="ob-lead">Sign in with Google to open Braintunnel.</p>
    </header>

    <div class="ob-cta-group">
      <button type="button" class="ob-btn-primary" onclick={() => continueWithGoogle()}>
        Continue with Google
      </button>
    </div>
  </OnboardingHeroShell>
</div>

<style>
  .hosted-signin-shell {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem 1rem;
    box-sizing: border-box;
  }
</style>
