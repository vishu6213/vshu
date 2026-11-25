import { describe, expect, it } from 'vitest'
import { OFFICIAL_MARKETPLACE_GIT_SOURCE } from '../../../shared/plugins/catalog/plugin-marketplace'
import { COMMUNITY_MARKETPLACE_GIT_SOURCE } from '../../../shared/plugins/catalog/plugin-install-link'
import {
  isRetiredPlaceholderCatalog,
  removeRetiredPlaceholderCatalogs
} from './plugin-marketplace-retired-sources'
import type { PluginMarketplaceRegisteredSource } from './plugin-marketplace-store'

const registered = (id: string, url: string): PluginMarketplaceRegisteredSource => ({
  id,
  source: { kind: 'git', url, ref: 'main' },
  addedAt: 1
})

describe('retired placeholder catalogs', () => {
  it('recognizes only the placeholder catalogs, in any URL spelling', () => {
    expect(isRetiredPlaceholderCatalog('git@github.com:vshu-ide/vshu-plugins.git')).toBe(true)
    expect(isRetiredPlaceholderCatalog('https://github.com/VSHU-IDE/vshu-community-plugins')).toBe(
      true
    )
    expect(isRetiredPlaceholderCatalog(OFFICIAL_MARKETPLACE_GIT_SOURCE.url)).toBe(false)
    expect(isRetiredPlaceholderCatalog(COMMUNITY_MARKETPLACE_GIT_SOURCE.url)).toBe(false)
  })

  it('removes registered placeholder catalogs and keeps the rest', async () => {
    let sources = [
      registered('a'.repeat(32), OFFICIAL_MARKETPLACE_GIT_SOURCE.url),
      registered('b'.repeat(32), 'https://github.com/vshu-ide/vshu-plugins.git'),
      registered('c'.repeat(32), 'https://github.com/acme/plugins.git')
    ]
    await removeRetiredPlaceholderCatalogs({
      listSources: async () => sources,
      removeSource: async (id) => {
        sources = sources.filter((source) => source.id !== id)
        return true
      }
    })
    expect(sources.map((source) => source.id)).toEqual(['a'.repeat(32), 'c'.repeat(32)])
  })
})
