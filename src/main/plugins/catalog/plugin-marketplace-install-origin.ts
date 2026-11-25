import type {
  PluginInstallSource,
  PluginLockEntry
} from '../../../shared/plugins/installation/plugin-install-lockfile'
import { isSamePluginSource } from '../../../shared/plugins/catalog/plugin-marketplace'
import { marketplaceSourceId } from './plugin-marketplace-store'

type MarketplaceInstallSource = Extract<PluginInstallSource, { kind: 'marketplace' }>
export type MarketplaceInstall = { sourceId: string; plugin: MarketplaceInstallSource['plugin'] }

/** The catalog a lock entry was installed from, or null when it was not a marketplace install. */
export function marketplaceInstallOf(entry: PluginLockEntry | null): MarketplaceInstall | null {
  if (entry?.source.kind !== 'marketplace') {
    return null
  }
  const { marketplace, plugin } = entry.source
  return {
    sourceId: marketplaceSourceId({ kind: 'git', url: marketplace.url, ref: marketplace.ref }),
    plugin
  }
}

/** Whether a catalog source would replace a marketplace install that came from another repository. */
export function marketplaceInstallMoved(
  entry: PluginLockEntry | null,
  source: { url: string; path?: string }
): boolean {
  const installed = marketplaceInstallOf(entry)
  return installed !== null && !isSamePluginSource(installed.plugin, source)
}

/** Whether a catalog listing still points at the exact plugin release that was previewed. */
export function marketplacePreviewMatchesListing(
  listing: {
    marketplaceCommit: string
    source: { url: string; path?: string }
    release?: { commit: string }
  },
  preview: {
    marketplaceCommit: string
    resolvedCommit: string
    source?: { url: string; path?: string }
  }
): boolean {
  return (
    (!preview.source || isSamePluginSource(listing.source, preview.source)) &&
    (listing.release
      ? listing.release.commit === preview.resolvedCommit
      : listing.marketplaceCommit === preview.marketplaceCommit)
  )
}
