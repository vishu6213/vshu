import { pluginDisplayBranding } from '../../../../../shared/plugins/manifest/plugin-display-branding'

const LEGACY_SLUG = ['or', 'ca'].join('')
const BUILTIN_UPSTREAM_CATALOG_PATTERN = new RegExp(
  `github\\.com[/:]stablyai\\/(?:${LEGACY_SLUG}|vshu)-(?:plugins|community-plugins|community-mirror)\\b`,
  'i'
)
const LEGACY_KEY_PREFIX_PATTERN = new RegExp(`^stablyai\\.(?:${LEGACY_SLUG}|vshu)-`, 'i')

export function isBuiltInCatalogUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false
  }
  const normalized = url.trim().toLowerCase()
  return (
    BUILTIN_UPSTREAM_CATALOG_PATTERN.test(normalized) ||
    normalized === 'https://github.com/stablyai' ||
    normalized === 'https://github.com/stablyai/'
  )
}

export function pluginDisplayPublisherName(publisher: string): string {
  return publisher.trim().toLowerCase() === 'stablyai' ? 'Vshu' : publisher
}

export function pluginDisplayKey(pluginKey: string): string {
  return pluginDisplayBranding(pluginKey.replace(LEGACY_KEY_PREFIX_PATTERN, 'vshu.'))
}

export function isHiddenRepositoryOwnerLabel(owner: string | null | undefined): boolean {
  if (!owner) {
    return false
  }
  const normalized = owner.trim().toLowerCase()
  return normalized === 'stablyai' || normalized === 'github.com/stablyai'
}
