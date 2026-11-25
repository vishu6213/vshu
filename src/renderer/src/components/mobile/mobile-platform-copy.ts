import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export type InstallCopy = { ctaLabel: string; url: string }

export const ANDROID_INSTALL_GUIDE_URL = 'https://vshu.dev/docs/android-apk'

export function getInstallCopy(platform: Platform, t: Translate = translate): InstallCopy {
  return platform === 'ios'
    ? {
        ctaLabel: t('auto.components.mobile.mobile.platform.copy.comingSoon', 'Coming Soon'),
        url: '#'
      }
    : {
        ctaLabel: t('auto.components.mobile.mobile.platform.copy.comingSoon', 'Coming Soon'),
        url: '#'
      }
}
