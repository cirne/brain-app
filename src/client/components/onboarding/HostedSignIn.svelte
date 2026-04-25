<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  function continueWithGoogle() {
    window.location.href = '/api/oauth/google/start'
  }
</script>

<div class="box-border flex min-h-0 flex-1 flex-col items-center justify-center p-6 px-4">
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
