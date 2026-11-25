import { createHash } from 'node:crypto'
import {
  vshudMigrationManifestHashInput,
  serializeVshudMigrationValue,
  type VshudMigrationManifest
} from '../../../shared/vshud-migration/vshud-migration-manifest'

export function computeVshudMigrationManifestSha256(
  manifest: Omit<VshudMigrationManifest, 'manifestSha256'>
): string {
  return createHash('sha256').update(vshudMigrationManifestHashInput(manifest)).digest('hex')
}

/** Hash the received manifest: unknown fields from newer peers are part of its signature. */
export function assertVshudMigrationManifestDigest(manifest: unknown): void {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('vshud_migration_manifest_invalid')
  }
  const unsigned = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestSha256')
  )
  const digest = createHash('sha256').update(serializeVshudMigrationValue(unsigned)).digest('hex')
  if (!('manifestSha256' in manifest) || digest !== manifest.manifestSha256) {
    throw new Error('vshud_migration_manifest_digest_mismatch')
  }
}
