import type { VshudMigrationStagedCatalog } from './vshud-migration-manifest'
import {
  VSHUD_MIGRATION_MANIFEST_VERSION,
  parseVshudMigrationManifest
} from './vshud-migration-manifest-validation'
import { isRecord } from './vshud-migration-manifest-fields'

export const MAX_VSHUD_MIGRATION_STAGED_CATALOGS = 4

export function normalizeVshudMigrationStagedCatalogs(
  value: unknown
): VshudMigrationStagedCatalog[] {
  if (!Array.isArray(value)) {
    return []
  }
  const staged: VshudMigrationStagedCatalog[] = []
  const seen = new Set<string>()
  for (let index = value.length - 1; index >= 0; index--) {
    try {
      const entry = parseStagedCatalog(value[index])
      if (!seen.has(entry.manifest.migrationId)) {
        seen.add(entry.manifest.migrationId)
        staged.push(entry)
        if (staged.length === MAX_VSHUD_MIGRATION_STAGED_CATALOGS) {
          break
        }
      }
    } catch {
      // Invalid staging cannot prove fencing; drop it fail-closed.
    }
  }
  // Keep the migration journal runnable in the documented Node 18 rollback slot.
  return staged.reduceRight<VshudMigrationStagedCatalog[]>((reversed, entry) => {
    reversed.push(entry)
    return reversed
  }, [])
}

function parseStagedCatalog(value: unknown): VshudMigrationStagedCatalog {
  if (!isRecord(value) || value.version !== VSHUD_MIGRATION_MANIFEST_VERSION) {
    throw new Error('vshud_migration_staged_catalog_invalid')
  }
  const stagedAt = typeof value.stagedAt === 'string' ? value.stagedAt : ''
  if (!Number.isFinite(Date.parse(stagedAt))) {
    throw new Error('vshud_migration_staged_at_invalid')
  }
  return {
    version: VSHUD_MIGRATION_MANIFEST_VERSION,
    manifest: parseVshudMigrationManifest(value.manifest),
    stagedAt
  }
}
