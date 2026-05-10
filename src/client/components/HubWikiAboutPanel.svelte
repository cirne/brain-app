<script lang="ts">
  import { t } from '@client/lib/i18n/index.js'
</script>

<div class="hub-wiki-about min-h-0 flex-1 overflow-auto px-5 pb-7 pt-4">
  <div class="hub-wiki-about-inner flex max-w-[36rem] flex-col gap-4 [&_p]:m-0 [&_p]:text-[0.9375rem] [&_p]:leading-[1.55] [&_p]:text-foreground">
    <p class="hub-wiki-about-lead text-base leading-[1.55] text-foreground">
      {$t('hub.hubWikiAboutPanel.lead.beforeWikiStrong')}
      <strong>{$t('hub.hubWikiAboutPanel.lead.wikiStrong')}</strong>
      {$t('hub.hubWikiAboutPanel.lead.afterWikiStrongBeforeVaultStrong')}
      <strong>{$t('hub.hubWikiAboutPanel.lead.vaultStrong')}</strong>
      {$t('hub.hubWikiAboutPanel.lead.afterVaultStrongBeforeEmphasis')}
      <em>{$t('hub.hubWikiAboutPanel.lead.emphasis')}</em>
      {$t('hub.hubWikiAboutPanel.lead.afterEmphasis')}
    </p>

    <h3 class="hub-wiki-about-h mt-1 text-[0.8125rem] font-bold uppercase tracking-[0.05em] text-muted">
      {$t('hub.hubWikiAboutPanel.sections.howAutomaticUpdatesWork')}
    </h3>
    <p>
      {$t('hub.hubWikiAboutPanel.howAutomaticUpdates.beforeYourWikiStrong')}
      <strong>{$t('hub.hubWikiAboutPanel.howAutomaticUpdates.yourWikiStrong')}</strong>
      {$t('hub.hubWikiAboutPanel.howAutomaticUpdates.afterYourWikiStrong')}
    </p>
    <ul
      class="hub-wiki-about-list m-0 flex flex-col gap-[0.65rem] pl-[1.15rem] text-[0.9375rem] leading-[1.5] text-foreground [&_li]:pl-[0.15rem]"
    >
      <li>
        <strong>{$t('hub.hubWikiAboutPanel.howAutomaticUpdates.enrichingLabel')}</strong>
        {$t('hub.hubWikiAboutPanel.howAutomaticUpdates.enrichingDescriptionBeforeWikilinks')}
        <span class="kbd border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-[0.35em] py-[0.08em] text-[0.85em] [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]">[[wikilinks]]</span>.
      </li>
      <li>
        <strong>{$t('hub.hubWikiAboutPanel.howAutomaticUpdates.cleaningUpLabel')}</strong>
        {$t('hub.hubWikiAboutPanel.howAutomaticUpdates.cleaningUpDescription')}
      </li>
    </ul>
    <p>
      {$t('hub.hubWikiAboutPanel.howAutomaticUpdates.whenFreshBeforeUpdateStrong')}
      <strong>{$t('hub.hubWikiAboutPanel.howAutomaticUpdates.updateWikiNowStrong')}</strong>
      {$t('hub.hubWikiAboutPanel.howAutomaticUpdates.whenFreshAfterUpdateStrong')}
    </p>

    <h3 class="hub-wiki-about-h mt-1 text-[0.8125rem] font-bold uppercase tracking-[0.05em] text-muted">
      {$t('hub.hubWikiAboutPanel.sections.sourcesVsWiki')}
    </h3>
    <p>
      {$t('hub.hubWikiAboutPanel.sourcesVsWiki.beforeSynthesizedKnowledgeBaseStrong')}
      <strong>{$t('hub.hubWikiAboutPanel.sourcesVsWiki.synthesizedKnowledgeBaseStrong')}</strong>
      {$t('hub.hubWikiAboutPanel.sourcesVsWiki.afterSynthesizedKnowledgeBaseStrong')}
    </p>

    <h3 class="hub-wiki-about-h mt-1 text-[0.8125rem] font-bold uppercase tracking-[0.05em] text-muted">
      {$t('hub.hubWikiAboutPanel.sections.youAreInControl')}
    </h3>
    <ul
      class="hub-wiki-about-list m-0 flex flex-col gap-[0.65rem] pl-[1.15rem] text-[0.9375rem] leading-[1.5] text-foreground [&_li]:pl-[0.15rem]"
    >
      <li>
        <strong>{$t('hub.hubWikiAboutPanel.control.vaultLabel')}</strong>
        {$t('hub.hubWikiAboutPanel.control.vaultDescription')}
      </li>
      <li>
        <strong>{$t('hub.hubWikiAboutPanel.control.pauseResumeLabel')}</strong>
        {$t('hub.hubWikiAboutPanel.control.pauseResumeDescription')}
      </li>
      <li>
        <strong>{$t('hub.hubWikiAboutPanel.control.editYourselfLabel')}</strong>
        {$t('hub.hubWikiAboutPanel.control.editYourselfDescription')}
      </li>
      <li>
        <strong>{$t('hub.hubWikiAboutPanel.control.moveAroundQuicklyLabel')}</strong>
        {$t('hub.hubWikiAboutPanel.control.moveAroundQuicklyBeforeAt')}
        <span class="kbd border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-[0.35em] py-[0.08em] text-[0.85em] [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]">@</span>
        {$t('hub.hubWikiAboutPanel.control.moveAroundQuicklyAfterAt')}
      </li>
    </ul>

    <p
      class="hub-wiki-about-foot mt-1 border-t border-[color-mix(in_srgb,var(--border)_55%,transparent)] pt-4 !text-[0.875rem] !leading-[1.5] !text-muted"
    >
      {$t('hub.hubWikiAboutPanel.footer')}
    </p>
  </div>
</div>
