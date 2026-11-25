import { isSameGitRepository } from '../../../shared/plugins/catalog/plugin-marketplace'
import type { PluginMarketplaceStore } from './plugin-marketplace-store'

// Why: early Vshu builds seeded the official and community catalogs from a placeholder
// organization that never existed. Those sources can only fail to load, and the real catalogs
// replace them.
const RETIRED_PLACEHOLDER_CATALOG_URLS: readonly string[] = [
  'https://github.com/vshu-ide/vshu-plugins.git',
  'https://github.com/vshu-ide/vshu-community-plugins.git'
]

export function isRetiredPlaceholderCatalog(url: string): boolean {
  return RETIRED_PLACEHOLDER_CATALOG_URLS.some((retired) => isSameGitRepository(url, retired))
}

/** Drops registered placeholder catalogs; a failure leaves them for the next seed. */
export async function removeRetiredPlaceholderCatalogs(
  store: Pick<PluginMarketplaceStore, 'listSources' | 'removeSource'>
): Promise<void> {
  const sources = await store.listSources()
  for (const source of sources.filter((candidate) =>
    isRetiredPlaceholderCatalog(candidate.source.url)
  )) {
    await store.removeSource(source.id).catch(() => undefined)
  }
}
