import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'

/** Older Vshu builds stored theme ids onboarding no longer offers; fall back to dark. */
export function knownTheme(raw: string | undefined): GlobalSettings['theme'] {
  return raw === 'system' || raw === 'light' || raw === 'dark' ? raw : 'dark'
}
