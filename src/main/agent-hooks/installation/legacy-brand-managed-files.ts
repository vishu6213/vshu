import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { brandMarkerVariants, legacySpellings } from '../../../shared/branding/legacy-brand-names'

/**
 * Deletes files a pre-rebrand build installed under its own brand's name next to the current ones,
 * so an agent does not load both. Only files carrying a spelling of `marker` are ours to delete.
 */
export function removeLegacyBrandManagedFiles(
  directory: string,
  fileNames: readonly string[],
  marker: string
): void {
  const markers = brandMarkerVariants(marker)
  for (const legacyName of fileNames.flatMap((fileName) => legacySpellings(fileName))) {
    const path = join(directory, legacyName)
    try {
      const text = readFileSync(path, 'utf8')
      if (markers.some((candidate) => text.includes(candidate))) {
        unlinkSync(path)
      }
    } catch {
      // Absent or unreadable: nothing of ours to remove.
    }
  }
}
