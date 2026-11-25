import { legacySpellings } from '../../branding/legacy-brand-names'
import { PLUGIN_MANIFEST_FILENAME } from './plugin-manifest'

/** Plugins written before the rebrand keep their manifest name, so read those when vshu-plugin.json is absent; newest brand first. */
export const PLUGIN_MANIFEST_FILE_NAMES: readonly string[] = [
  PLUGIN_MANIFEST_FILENAME,
  ...legacySpellings(PLUGIN_MANIFEST_FILENAME)
]

const LEGACY_ENGINE_KEYS = legacySpellings('vshu')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A pre-rebrand manifest states its host range under the old brand's `engines` key; the host
 * versions continue, so read that range as `engines.vshu`. Null when `raw` needs no change.
 */
export function withLegacyEngineRange(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw) || !isRecord(raw.engines) || 'vshu' in raw.engines) {
    return null
  }
  const engines = raw.engines
  const legacyKey = LEGACY_ENGINE_KEYS.find((key) => key in engines)
  if (legacyKey === undefined) {
    return null
  }
  const { [legacyKey]: range, ...rest } = engines
  for (const key of LEGACY_ENGINE_KEYS) {
    delete rest[key]
  }
  return { ...raw, engines: { ...rest, vshu: range } }
}
