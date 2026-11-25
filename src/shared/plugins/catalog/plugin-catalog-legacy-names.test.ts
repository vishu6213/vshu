import { describe, expect, it } from 'vitest'
import { ORIGINAL_BRAND_NAME } from '../../branding/legacy-brand-names'
import { PLUGIN_CATALOG_FILENAME, pluginCatalogSchema } from './plugin-catalog'
import { OFFICIAL_MARKETPLACE_GIT_SOURCE, PLUGIN_MARKETPLACE_FILENAME } from './plugin-marketplace'
import {
  isPluginCatalogFileName,
  PLUGIN_CATALOG_INDEX_FILE_NAMES,
  withLegacyCatalogReleaseFields
} from './plugin-catalog-legacy-names'

// Legacy words come from fragments: the rebrand codemod rewrites literal ones.
const legacy = ORIGINAL_BRAND_NAME
const legacyMinimumKey = `minimum${legacy[0]!.toUpperCase()}${legacy.slice(1)}`

describe('plugin catalog legacy names', () => {
  it('prefers any v2 catalog over the frozen v1 file, current name first', () => {
    const v2Legacy = `${legacy}-catalog.json`
    expect(PLUGIN_CATALOG_INDEX_FILE_NAMES[0]).toBe(PLUGIN_CATALOG_FILENAME)
    expect(PLUGIN_CATALOG_INDEX_FILE_NAMES.indexOf(v2Legacy)).toBeLessThan(
      PLUGIN_CATALOG_INDEX_FILE_NAMES.indexOf(PLUGIN_MARKETPLACE_FILENAME)
    )
    expect(PLUGIN_CATALOG_INDEX_FILE_NAMES).toContain(`${legacy}-marketplace.json`)
    expect(isPluginCatalogFileName(v2Legacy)).toBe(true)
    expect(isPluginCatalogFileName(PLUGIN_MARKETPLACE_FILENAME)).toBe(false)
  })

  it('reads a pre-rebrand release minimum as minimumVshu', () => {
    const raw = {
      catalogVersion: 2,
      name: 'Official Plugins',
      owner: 'stablyai',
      plugins: [
        {
          id: `stablyai.${legacy}-midnight-theme`,
          source: {
            kind: 'git',
            url: OFFICIAL_MARKETPLACE_GIT_SOURCE.url,
            ref: 'main',
            path: 'plugins/midnight-theme'
          },
          releases: [
            {
              version: '2.1.1',
              commit: 'a'.repeat(40),
              contentHash: 'b'.repeat(64),
              execution: 'data',
              [legacyMinimumKey]: '1.4.245'
            }
          ]
        }
      ]
    }
    const parsed = pluginCatalogSchema.parse(withLegacyCatalogReleaseFields(raw))
    expect(parsed.plugins[0]?.releases?.[0]?.minimumVshu).toBe('1.4.245')
  })

  it('keeps a current minimum and passes through what is not catalog-shaped', () => {
    const release = { minimumVshu: '2.0.0', [legacyMinimumKey]: '1.0.0' }
    expect(withLegacyCatalogReleaseFields({ plugins: [{ releases: [release] }] })).toEqual({
      plugins: [{ releases: [release] }]
    })
    expect(withLegacyCatalogReleaseFields(null)).toBeNull()
    expect(withLegacyCatalogReleaseFields({ plugins: 'x' })).toEqual({ plugins: 'x' })
  })
})
