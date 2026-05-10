<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
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
      <span class="ob-kicker">{$t('onboarding.hostedSignIn.kicker')}</span>
      <h1 id="hosted-signin-title" class="ob-headline">{$t('onboarding.hostedSignIn.title')}</h1>
      <p class="ob-lead">{$t('onboarding.hostedSignIn.lead')}</p>
    </header>

    <div class="ob-cta-group">
      <button type="button" class="ob-btn-primary" onclick={() => continueWithGoogle()}>
        {$t('onboarding.hostedSignIn.continueWithGoogle')}
      </button>
    </div>
  </OnboardingHeroShell>
</div>
