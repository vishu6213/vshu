import type { PluginListEntry } from './plugin-list-entries'

/** Search across what a user can see or would type: name, key, publisher, description, categories. */
export function matchesPluginSearch(entry: PluginListEntry, search: string): boolean {
  const query = search.trim().toLowerCase()
  return (
    !query ||
    [
      entry.name,
      entry.pluginKey,
      entry.publisher,
      entry.description,
      entry.listing?.marketplaceName,
      ...entry.categories
    ].some((value) => (value ?? '').toLowerCase().includes(query))
  )
}
