import { navigate, type NavigateOptions, type Route } from '@client/router.js'

/** Like `navigate` but merges bar title for `/c/{slug}--{12hex}` URLs — closure lives here, not inline in the shell. */
export function createShellNavigate(getChatTitleForUrl: () => string | null | undefined) {
  function optsWithBarTitle(opts?: NavigateOptions): NavigateOptions {
    const title =
      opts && 'chatTitleForUrl' in opts ? opts.chatTitleForUrl : getChatTitleForUrl()
    return { ...opts, chatTitleForUrl: title ?? undefined }
  }
  function navigateShell(target: Route, opts?: NavigateOptions) {
    navigate(target, optsWithBarTitle(opts))
  }
  return { navigateShell, optsWithBarTitle }
}
