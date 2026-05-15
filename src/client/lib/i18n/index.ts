import i18next, { type TOptions } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { writable, type Readable } from 'svelte/store'

import accessEn from './locales/en/access.json'
import cardsEn from './locales/en/cards.json'
import chatEn from './locales/en/chat.json'
import commonEn from './locales/en/common.json'
import hubEn from './locales/en/hub.json'
import inboxEn from './locales/en/inbox.json'
import navEn from './locales/en/nav.json'
import onboardingEn from './locales/en/onboarding.json'
import searchEn from './locales/en/search.json'
import settingsEn from './locales/en/settings.json'
import wikiEn from './locales/en/wiki.json'

const NAMESPACES = [
  'common',
  'nav',
  'chat',
  'onboarding',
  'wiki',
  'inbox',
  'hub',
  'search',
  'settings',
  'cards',
  'access',
] as const

type Namespace = (typeof NAMESPACES)[number]

type TranslateOptions = TOptions & {
  defaultValue?: string
}

export type TranslateFn = (
  key: string,
  defaultValueOrOptions?: string | TranslateOptions,
  maybeOptions?: TranslateOptions,
) => string

const namespaceSet = new Set<string>(NAMESPACES)

function splitNamespace(key: string): { ns?: Namespace; key: string } {
  const [head, ...tail] = key.split('.')
  if (!tail.length || !namespaceSet.has(head)) return { key }
  return { ns: head as Namespace, key: tail.join('.') }
}

function normalizeOptions(
  defaultValueOrOptions?: string | TranslateOptions,
  maybeOptions?: TranslateOptions,
): TranslateOptions | undefined {
  if (typeof defaultValueOrOptions === 'string') {
    return { ...maybeOptions, defaultValue: defaultValueOrOptions }
  }
  return defaultValueOrOptions
}

function translate(
  key: string,
  defaultValueOrOptions?: string | TranslateOptions,
  maybeOptions?: TranslateOptions,
): string {
  const options = normalizeOptions(defaultValueOrOptions, maybeOptions)
  const split = splitNamespace(key)
  const fallback = options?.defaultValue ?? key
  if (split.ns) {
    const value = i18next.t(split.key, { ns: split.ns, ...options })
    return typeof value === 'string' && value.length > 0 ? value : fallback
  }
  const value = i18next.t(split.key, options)
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** Synchronous translate for non-Svelte modules (policy grouping, tests). Requires {@link initI18n} in app/tests. */
export function translateClient(
  key: string,
  defaultValueOrOptions?: string | TranslateOptions,
  maybeOptions?: TranslateOptions,
): string {
  return translate(key, defaultValueOrOptions, maybeOptions)
}

const translateStore = writable<TranslateFn>(translate)

function refreshTranslateStore() {
  translateStore.set(translate)
}

i18next.on('languageChanged', refreshTranslateStore)
i18next.on('loaded', refreshTranslateStore)

let initPromise: Promise<void> | null = null

type InitOptions = {
  forceLanguage?: string
}

export function initI18n(options?: InitOptions): Promise<void> {
  if (initPromise) return initPromise

  if (typeof window !== 'undefined') {
    i18next.use(LanguageDetector)
  }

  initPromise = i18next
    .init({
      resources: {
        en: {
          common: commonEn,
          nav: navEn,
          chat: chatEn,
          onboarding: onboardingEn,
          wiki: wikiEn,
          inbox: inboxEn,
          hub: hubEn,
          search: searchEn,
          settings: settingsEn,
          cards: cardsEn,
          access: accessEn,
        },
      },
      lng: options?.forceLanguage ?? 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: NAMESPACES as unknown as string[],
      initAsync: false,
      interpolation: { escapeValue: false },
      detection: typeof window !== 'undefined'
        ? {
            order: ['querystring', 'navigator'],
            lookupQuerystring: 'lang',
            caches: [],
          }
        : undefined,
    })
    .then(() => {
      refreshTranslateStore()
    })

  return initPromise
}

export async function setLanguage(language: string): Promise<void> {
  await initI18n()
  if (i18next.language === language) return
  await i18next.changeLanguage(language)
}

export const t: Readable<TranslateFn> = {
  subscribe: translateStore.subscribe,
}

