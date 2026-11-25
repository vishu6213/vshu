import { describe, expect, it } from 'vitest'
import { LEGACY_BRANDS } from '../../../shared/branding/legacy-brand-names'
import {
  migrateLegacyBrandLocalStorage,
  rebrandLegacyStorageKey
} from './legacy-brand-local-storage'

// LEGACY_BRANDS is fragment-built, so these stay pre-rebrand spellings under the codemod.
const [NEWER, ORIGINAL] = LEGACY_BRANDS

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear()
  }
}

describe('legacy brand localStorage migration', () => {
  it('renames only a leading brand prefix', () => {
    expect(rebrandLegacyStorageKey(`${ORIGINAL}.web.settings.v1`)).toBe('vshu.web.settings.v1')
    expect(rebrandLegacyStorageKey(`${NEWER}:draft:/src/${ORIGINAL}/x`)).toBe(
      `vshu:draft:/src/${ORIGINAL}/x`
    )
    expect(rebrandLegacyStorageKey(`${ORIGINAL}chestra.mode`)).toBeNull()
    expect(rebrandLegacyStorageKey('theme')).toBeNull()
  })

  it('copies legacy keys once, prefers the newer brand and never overwrites', () => {
    const storage = memoryStorage({
      [`${ORIGINAL}.quick-open-history.v1`]: 'old history',
      [`${ORIGINAL}-floating-terminal-panel-bounds-v1`]: 'oldest bounds',
      [`${NEWER}-floating-terminal-panel-bounds-v1`]: 'newer bounds',
      [`${ORIGINAL}.web.settings.v1`]: 'old settings',
      'vshu.web.settings.v1': 'current settings'
    })

    expect(migrateLegacyBrandLocalStorage(storage)).toBe(2)

    expect(storage.getItem('vshu.quick-open-history.v1')).toBe('old history')
    expect(storage.getItem('vshu-floating-terminal-panel-bounds-v1')).toBe('newer bounds')
    expect(storage.getItem('vshu.web.settings.v1')).toBe('current settings')
    expect(storage.getItem(`${ORIGINAL}.quick-open-history.v1`)).toBe('old history')

    storage.setItem(`${ORIGINAL}.late.v1`, 'late')
    expect(migrateLegacyBrandLocalStorage(storage)).toBe(0)
    expect(storage.getItem('vshu.late.v1')).toBeNull()
  })
})
