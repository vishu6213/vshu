import { LEGACY_BRANDS } from '../../../shared/branding/legacy-brand-names'

const CURRENT_BRAND = 'vshu'
const MIGRATED_MARKER = `${CURRENT_BRAND}.legacyBrandLocalStorage.migrated.v1`
// Keys are `<brand>` plus a separator; only that prefix is renamed, because the rest can hold ids or paths.
const PREFIX_SEPARATORS = new Set(['.', ':', '-', '_'])

/** The vshu key a pre-rebrand key maps to, or null when `key` does not start with a legacy brand. */
export function rebrandLegacyStorageKey(key: string): string | null {
  for (const brand of LEGACY_BRANDS) {
    if (key.startsWith(brand) && PREFIX_SEPARATORS.has(key.charAt(brand.length))) {
      return `${CURRENT_BRAND}${key.slice(brand.length)}`
    }
  }
  return null
}

/**
 * One-time copy of settings and drafts earlier builds kept under legacy-branded keys to the keys this
 * build reads. Newer brands win, existing values are never overwritten, and old keys stay as a backup.
 */
export function migrateLegacyBrandLocalStorage(storage: Storage): number {
  if (storage.getItem(MIGRATED_MARKER) !== null) {
    return 0
  }
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key !== null) {
      keys.push(key)
    }
  }
  // LEGACY_BRANDS is newest first, so copy newer keys first and let older ones only fill gaps.
  const rank = (key: string): number => LEGACY_BRANDS.findIndex((brand) => key.startsWith(brand))
  let copied = 0
  for (const key of keys.sort((left, right) => rank(left) - rank(right))) {
    const target = rebrandLegacyStorageKey(key)
    const value = storage.getItem(key)
    if (target === null || value === null || storage.getItem(target) !== null) {
      continue
    }
    storage.setItem(target, value)
    copied++
  }
  storage.setItem(MIGRATED_MARKER, new Date().toISOString())
  return copied
}

/** Side-effect entry: runs before any module reads its key. Storage may be unavailable or full. */
export function runLegacyBrandLocalStorageMigration(): void {
  try {
    migrateLegacyBrandLocalStorage(window.localStorage)
  } catch (error) {
    console.warn('[legacy-brand-local-storage] skipped', error)
  }
}
