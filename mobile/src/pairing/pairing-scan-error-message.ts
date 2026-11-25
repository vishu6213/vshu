import type { Translate } from '../i18n/mobile-i18n'

function isVshuInstallUrl(data: string): boolean {
  try {
    const url = new URL(data.trim())
    const path = url.pathname.replace(/\/$/, '')
    switch (url.origin) {
      case 'https://apps.apple.com':
        return /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id6766130217$/.test(path)
      // vshu.dev: desktops released before the move to vshu.dev show the old host.
      case 'https://vshu.dev':
      case 'https://www.vshu.dev':
      case 'https://www.vshu.dev':
      case 'https://vshu.dev':
        return path === '/download/android'
      // Older desktops offered TestFlight and versioned APK downloads.
      case 'https://testflight.apple.com':
        return path === '/join/YjeGMQBA'
      case 'https://github.com':
        return /^\/vishu6213\/vshu\/releases\/download\/mobile-android-v[^/]+\/app-release\.apk$/.test(
          path
        )
      default:
        return false
    }
  } catch {
    return false
  }
}

export function getPairingScanErrorMessage(data: string, t: Translate): string {
  return isVshuInstallUrl(data)
    ? t(
        'app.pairScan.downloadQrCode',
        "That's the download code. Scan the pairing code in step 2 on your desktop."
      )
    : t('app.pairScan.invalidQrCode', 'Not a valid Vshu QR code')
}
