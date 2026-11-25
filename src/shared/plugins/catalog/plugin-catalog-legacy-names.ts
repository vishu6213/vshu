import { legacySpellings } from '../../branding/legacy-brand-names'
import { PLUGIN_CATALOG_FILENAME } from './plugin-catalog'
import { PLUGIN_MARKETPLACE_FILENAME } from './plugin-marketplace'

/** The v2 catalog under every name it has had, current first. The official catalogs Vshu reads
 *  are upstream's and still publish the pre-rebrand names. */
export const PLUGIN_CATALOG_FILE_NAMES: readonly string[] = [
  PLUGIN_CATALOG_FILENAME,
  ...legacySpellings(PLUGIN_CATALOG_FILENAME)
]

/** Index files a catalog repository may publish, in preference order: any v2 catalog before
 *  the frozen v1 file. */
export const PLUGIN_CATALOG_INDEX_FILE_NAMES: readonly string[] = [
  ...PLUGIN_CATALOG_FILE_NAMES,
  PLUGIN_MARKETPLACE_FILENAME,
  ...legacySpellings(PLUGIN_MARKETPLACE_FILENAME)
]

export function isPluginCatalogFileName(fileName: string): boolean {
  return PLUGIN_CATALOG_FILE_NAMES.includes(fileName)
}

const RELEASE_MINIMUM_KEY = 'minimumVshu'
const LEGACY_RELEASE_MINIMUM_KEYS = legacySpellings(RELEASE_MINIMUM_KEY)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withLegacyReleaseMinimum(release: unknown): unknown {
  if (!isRecord(release) || RELEASE_MINIMUM_KEY in release) {
    return release
  }
  const legacyKey = LEGACY_RELEASE_MINIMUM_KEYS.find((key) => key in release)
  if (legacyKey === undefined) {
    return release
  }
  const { [legacyKey]: minimum, ...rest } = release
  return { ...rest, [RELEASE_MINIMUM_KEY]: minimum }
}

/**
 * A pre-rebrand catalog states each release's minimum host version under the old brand's key
 * (host versions continue across the rebrand), so read it as `minimumVshu`. Returns `raw`
 * unchanged when it is not catalog-shaped.
 */
export function withLegacyCatalogReleaseFields(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.plugins)) {
    return raw
  }
  return {
    ...raw,
    plugins: raw.plugins.map((plugin) =>
      isRecord(plugin) && Array.isArray(plugin.releases)
        ? { ...plugin, releases: plugin.releases.map(withLegacyReleaseMinimum) }
        : plugin
    )
  }
}
