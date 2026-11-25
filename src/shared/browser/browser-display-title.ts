import { redactKagiSessionToken } from './navigation/browser-url'
import { VSHU_BROWSER_BLANK_URL } from './browser-blank-page'

export function getBrowserDisplayTitle(title: string | null | undefined, url: string): string {
  if (
    url === 'about:blank' ||
    url === VSHU_BROWSER_BLANK_URL ||
    title === 'about:blank' ||
    title === VSHU_BROWSER_BLANK_URL
  ) {
    return 'New Tab'
  }
  return title || redactKagiSessionToken(url) || 'New Tab'
}
