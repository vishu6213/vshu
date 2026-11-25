import type {
  VshudMigrationCatalogAbortResult,
  VshudMigrationCatalogReference,
  VshudMigrationCatalogReferenceAbortResult,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { StoreRuntimeState } from '../../loading-store/store-runtime-state'

export function stagedManifests(state: StoreRuntimeState['state']): VshudMigrationManifest[] {
  return (state.vshudMigrationStagedCatalogs ?? []).map((entry) => entry.manifest)
}

export function committedMigrations(
  state: StoreRuntimeState['state']
): { migrationId: string; manifestSha256: string }[] {
  return [
    ...(state.vshudMigrationImportReceipts ?? []),
    ...(state.vshudMigrationEvictedReceipts ?? [])
  ]
}

/** Use the stored manifest; an existing commit takes precedence over abort. */
export function abortVshudMigrationCatalogByReference(
  state: StoreRuntimeState['state'],
  reference: VshudMigrationCatalogReference,
  abortStaged: (manifest: VshudMigrationManifest) => VshudMigrationCatalogAbortResult
): VshudMigrationCatalogReferenceAbortResult {
  const identity = { migrationId: reference.migrationId, manifestSha256: reference.manifestSha256 }
  const committed = committedMigrations(state).find(
    (entry) => entry.migrationId === reference.migrationId
  )
  const staged = stagedManifests(state).find(
    (manifest) => manifest.migrationId === reference.migrationId
  )
  const held = committed ?? staged
  if (held && held.manifestSha256 !== reference.manifestSha256) {
    throw new Error('vshud_migration_id_reused_with_different_manifest')
  }
  if (committed) {
    return { ...identity, state: 'committed', aborted: false }
  }
  if (!staged) {
    return { ...identity, state: 'absent', aborted: false }
  }
  const result = abortStaged(staged)
  return {
    ...identity,
    state: result.state === 'committed' ? 'committed' : 'absent',
    aborted: result.aborted
  }
}
