// Commit receipts remain authoritative indefinitely; abandoned stages expire.
import { MAX_VSHUD_MIGRATION_IMPORT_RECEIPTS } from '../../../../shared/vshud-migration/vshud-migration-manifest-validation'
import type {
  VshudMigrationImportReceipt,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { MAX_VSHUD_MIGRATION_EVICTED_RECEIPTS } from '../../../../shared/vshud-migration/vshud-migration-evicted-receipts'
import type { PersistedState } from '../../../../shared/vshu-profiles/persisted-state-types'
import type { StoreRuntimeState } from '../../loading-store/store-runtime-state'
import {
  vshudMigrationStagingKey,
  type VshudMigrationRequestIdentity
} from '../blob-transfer/vshud-migration-staged-file'

// Allow a week for clients that went offline mid-move.
export const VSHUD_MIGRATION_STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function findVshudMigrationImportReceipt(
  state: PersistedState,
  manifest: VshudMigrationManifest
): VshudMigrationImportReceipt | undefined {
  const receipt = state.vshudMigrationImportReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  if (receipt) {
    return receipt
  }
  const evicted = state.vshudMigrationEvictedReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  // Rebuild the remaining receipt fields from the manifest.
  return evicted
    ? {
        version: manifest.version,
        migrationId: evicted.migrationId,
        manifestSha256: evicted.manifestSha256,
        source: structuredClone(manifest.source),
        importedAt: evicted.importedAt,
        repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
        projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
        folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
      }
    : undefined
}

/** Compact evicted receipts without losing proof of commit. */
export function recordVshudMigrationImportReceipt(
  state: PersistedState,
  receipt: VshudMigrationImportReceipt
): void {
  const receipts = [...(state.vshudMigrationImportReceipts ?? []), receipt]
  const overflow = receipts.length - MAX_VSHUD_MIGRATION_IMPORT_RECEIPTS
  if (overflow > 0) {
    state.vshudMigrationEvictedReceipts = [
      ...(state.vshudMigrationEvictedReceipts ?? []),
      ...receipts.slice(0, overflow).map(({ migrationId, manifestSha256, importedAt }) => ({
        migrationId,
        manifestSha256,
        importedAt
      }))
    ].slice(-MAX_VSHUD_MIGRATION_EVICTED_RECEIPTS)
  }
  state.vshudMigrationImportReceipts = receipts.slice(-MAX_VSHUD_MIGRATION_IMPORT_RECEIPTS)
}

export function isLiveVshudMigrationStage(stagedAt: string, now: number): boolean {
  return now - Date.parse(stagedAt) < VSHUD_MIGRATION_STAGE_TTL_MS
}

export function expireVshudMigrationStages(state: PersistedState, now: number): boolean {
  const staged = state.vshudMigrationStagedCatalogs ?? []
  const live = staged.filter((entry) => isLiveVshudMigrationStage(entry.stagedAt, now))
  if (live.length === staged.length) {
    return false
  }
  state.vshudMigrationStagedCatalogs = live
  return true
}

export type VshudMigrationCommitGenerationRuntime = Pick<
  StoreRuntimeState,
  'writeGeneration' | 'lastDurableWriteGeneration' | 'vshudMigrationCommitWriteGenerations'
>

/** Call right after the commit's `scheduleSave`; `generationBefore` is read just before it. */
export function recordVshudMigrationCommitWriteGeneration(
  runtime: VshudMigrationCommitGenerationRuntime,
  migration: VshudMigrationRequestIdentity,
  generationBefore: number
): void {
  // Suppressed saves never advance generation; only a disk-loaded receipt can prove durability.
  runtime.vshudMigrationCommitWriteGenerations.set(
    vshudMigrationStagingKey(migration),
    runtime.writeGeneration > generationBefore ? runtime.writeGeneration : Number.POSITIVE_INFINITY
  )
}

/** Require disk durability before consuming blobs a restart might need to retry. */
export function isVshudMigrationCommitDurable(
  runtime: VshudMigrationCommitGenerationRuntime,
  migration: VshudMigrationRequestIdentity
): boolean {
  const key = vshudMigrationStagingKey(migration)
  const required = runtime.vshudMigrationCommitWriteGenerations.get(key)
  if (required === undefined) {
    return true
  }
  if (runtime.lastDurableWriteGeneration < required) {
    return false
  }
  runtime.vshudMigrationCommitWriteGenerations.delete(key)
  return true
}
