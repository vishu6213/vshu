import { MAX_VSHUD_MIGRATION_STAGED_CATALOGS } from '../../../shared/vshud-migration/vshud-migration-staged-catalog-validation'
import { VSHUD_CATALOG_COMMIT_DOMAINS } from './catalog-commit/vshud-catalog-commit-domains'
import { VSHUD_MIGRATION_MANIFEST_VERSION } from '../../../shared/vshud-migration/vshud-migration-manifest-validation'
import type {
  VshudMigrationCatalogAbortResult,
  VshudMigrationCatalogReference,
  VshudMigrationCatalogReferenceAbortResult,
  VshudMigrationCatalogState,
  VshudMigrationImportReceipt,
  VshudMigrationManifest
} from '../../../shared/vshud-migration/vshud-migration-manifest'
import type {
  VshudMigrationSnapshotChunkRequest,
  VshudMigrationSnapshotChunkResult
} from '../../../shared/vshud-migration/vshud-migration-scrollback'
import type {
  VshudMigrationBlobChunkRequest,
  VshudMigrationBlobChunkResult,
  VshudMigrationBlobDescriptor
} from '../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type { RepoLifecycleOperations } from '../loading-store/project-catalog/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'

import { scheduleSave } from '../loading-store/profile-writing/write-scheduling'
import type { WriteSchedulingOperations } from '../loading-store/profile-writing/write-scheduling'
import {
  applyPreparedVshudMigrationCatalog,
  assertVshudMigrationReceiptMatchesManifest,
  assertSameVshudMigrationManifest,
  prepareVshudMigrationCatalog,
  type PreparedVshudMigrationCatalog
} from './catalog-commit/vshud-catalog-records'
import {
  expireVshudMigrationStages,
  findVshudMigrationImportReceipt,
  isLiveVshudMigrationStage,
  recordVshudMigrationCommitWriteGeneration,
  recordVshudMigrationImportReceipt,
  type VshudMigrationCommitGenerationRuntime
} from './catalog-commit/vshud-catalog-receipt-ledger'
import {
  abortVshudMigrationSnapshots,
  assertVshudMigrationSnapshotsReady,
  commitVshudMigrationSnapshots,
  inspectVshudMigrationSnapshotUploads,
  pruneVshudMigrationSnapshotStaging,
  stageVshudMigrationSnapshotChunk
} from './terminal-history/vshud-scrollback-snapshot-transfer'
import {
  abortVshudMigrationBlobs,
  assertVshudMigrationBlobSetMatches,
  assertVshudMigrationBlobsReady,
  commitVshudMigrationBlobs,
  inspectVshudMigrationBlobUploads,
  pruneVshudMigrationBlobStaging,
  stageVshudMigrationBlobChunk
} from './blob-transfer/vshud-migration-blob-staging'
import { withStagedAutomationRunHistory } from './catalog-commit/vshud-staged-automation-run-history'
import { assertVshudMigrationBlobContentsValid } from './blob-transfer/vshud-migration-blob-installers'
import {
  abortVshudMigrationCatalogByReference,
  committedMigrations,
  stagedManifests
} from './catalog-commit/vshud-catalog-reference-abort'

type VshudCatalogImportRuntime = VshudMigrationCommitGenerationRuntime &
  Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage' | 'vshudMigrationBlobRoot'>

const vshudCatalogImportContext = Symbol('VshudCatalogImportPersistence')
type VshudCatalogImportContext = {
  runtime: VshudCatalogImportRuntime
  repos: RepoLifecycleOperations
  scheduling: WriteSchedulingOperations
}

// Manifests arrive parsed; the RPC boundary verified the digest over the bytes as sent.

export class VshudCatalogImportPersistence {
  readonly [vshudCatalogImportContext]: VshudCatalogImportContext

  constructor(
    runtime: VshudCatalogImportRuntime,
    repos: RepoLifecycleOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[vshudCatalogImportContext] = { runtime, repos, scheduling }
  }

  stageVshudMigrationCatalog(
    manifest: VshudMigrationManifest,
    options: { now?: () => Date } = {}
  ): VshudMigrationCatalogState {
    const context = this[vshudCatalogImportContext]
    const now = options.now ?? (() => new Date())
    if (expireVshudMigrationStages(context.runtime.state, now().getTime())) {
      scheduleSave(context.scheduling, ['vshudMigrationStagedCatalogs'])
    }
    pruneVshudMigrationSnapshotStaging(
      stagedManifests(context.runtime.state),
      context.runtime.terminalScrollbackSnapshotStorage
    )
    pruneVshudMigrationBlobStaging(
      stagedManifests(context.runtime.state),
      committedMigrations(context.runtime.state),
      context.runtime.vshudMigrationBlobRoot
    )
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    prepareVshudMigrationCatalog(manifest, context.runtime.state)
    if (current.state === 'staged') {
      return current
    }
    const staged = context.runtime.state.vshudMigrationStagedCatalogs ?? []
    if (staged.length >= MAX_VSHUD_MIGRATION_STAGED_CATALOGS) {
      throw new Error('vshud_migration_staging_capacity_exceeded')
    }
    const stagedAt = now().toISOString()
    context.runtime.state.vshudMigrationStagedCatalogs = [
      ...staged,
      {
        version: VSHUD_MIGRATION_MANIFEST_VERSION,
        manifest: structuredClone(manifest),
        stagedAt
      }
    ]
    scheduleSave(context.scheduling, ['vshudMigrationStagedCatalogs'])
    return stagedCatalogState(manifest, stagedAt, context.runtime)
  }

  stageVshudMigrationSnapshotChunk(
    request: VshudMigrationSnapshotChunkRequest
  ): VshudMigrationSnapshotChunkResult {
    const context = this[vshudCatalogImportContext]
    return stageVshudMigrationSnapshotChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      storage: context.runtime.terminalScrollbackSnapshotStorage,
      request
    })
  }

  stageVshudMigrationBlobChunk(
    request: VshudMigrationBlobChunkRequest
  ): VshudMigrationBlobChunkResult {
    const context = this[vshudCatalogImportContext]
    return stageVshudMigrationBlobChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      root: context.runtime.vshudMigrationBlobRoot,
      request
    })
  }

  /** Omitted expectedBlobs preserves older senders' commit behavior. */
  commitStagedVshudMigrationCatalog(
    manifest: VshudMigrationManifest,
    options: { now?: () => Date; expectedBlobs?: readonly VshudMigrationBlobDescriptor[] } = {}
  ): VshudMigrationCatalogState {
    const context = this[vshudCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    if (current.state !== 'staged') {
      throw new Error('vshud_migration_catalog_not_staged')
    }
    const blobRoot = context.runtime.vshudMigrationBlobRoot
    assertVshudMigrationSnapshotsReady(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    if (options.expectedBlobs) {
      assertVshudMigrationBlobSetMatches(manifest, blobRoot, options.expectedBlobs)
    }
    assertVshudMigrationBlobsReady(manifest, blobRoot)
    assertVshudMigrationBlobContentsValid(manifest, blobRoot)
    const prepared = prepareVshudMigrationCatalog(
      withStagedAutomationRunHistory(manifest, blobRoot),
      context.runtime.state
    )
    commitVshudMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    commitVshudMigrationBlobs(manifest, blobRoot)
    const receipt = commitPreparedCatalog(context, manifest, prepared, options.now)
    const generationBefore = context.runtime.writeGeneration
    scheduleSave(context.scheduling, VSHUD_CATALOG_COMMIT_DOMAINS)
    recordVshudMigrationCommitWriteGeneration(context.runtime, manifest, generationBefore)
    return committedCatalogState(receipt)
  }

  abortStagedVshudMigrationCatalog(
    manifest: VshudMigrationManifest
  ): VshudMigrationCatalogAbortResult {
    const context = this[vshudCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed' || current.state === 'absent') {
      return { ...current, aborted: false }
    }
    // Staged rows are dormant and unreferenced outside this stage.
    context.runtime.state.vshudMigrationStagedCatalogs = (
      context.runtime.state.vshudMigrationStagedCatalogs ?? []
    ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
    abortVshudMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    abortVshudMigrationBlobs(manifest, context.runtime.vshudMigrationBlobRoot)
    scheduleSave(context.scheduling, ['vshudMigrationStagedCatalogs'])
    return { ...absentCatalogState(manifest), aborted: true }
  }

  /** Use the stored manifest when the source cannot send one. */
  abortStagedVshudMigrationCatalogByReference(
    reference: VshudMigrationCatalogReference
  ): VshudMigrationCatalogReferenceAbortResult {
    return abortVshudMigrationCatalogByReference(
      this[vshudCatalogImportContext].runtime.state,
      reference,
      (manifest) => this.abortStagedVshudMigrationCatalog(manifest)
    )
  }

  getVshudMigrationCatalogState(manifest: VshudMigrationManifest): VshudMigrationCatalogState {
    const context = this[vshudCatalogImportContext]
    return migrationCatalogState(context.runtime, manifest)
  }

  hasStagedVshudMigrationCatalog(now: number = Date.now()): boolean {
    return (this[vshudCatalogImportContext].runtime.state.vshudMigrationStagedCatalogs ?? []).some(
      (entry) => isLiveVshudMigrationStage(entry.stagedAt, now)
    )
  }
}

function commitPreparedCatalog(
  context: VshudCatalogImportContext,
  manifest: VshudMigrationManifest,
  prepared: PreparedVshudMigrationCatalog,
  now?: () => Date
): VshudMigrationImportReceipt {
  applyPreparedVshudMigrationCatalog(prepared, context.runtime.state, context.repos)
  const receipt: VshudMigrationImportReceipt = {
    version: VSHUD_MIGRATION_MANIFEST_VERSION,
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    source: structuredClone(manifest.source),
    importedAt: (now ?? (() => new Date()))().toISOString(),
    repositoryIds: prepared.repositories.map((repo) => repo.id),
    projectGroupIds: prepared.projectGroups.map((group) => group.id),
    folderWorkspaceIds: prepared.folderWorkspaces.map((workspace) => workspace.id)
  }
  context.runtime.state.vshudMigrationStagedCatalogs = (
    context.runtime.state.vshudMigrationStagedCatalogs ?? []
  ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
  recordVshudMigrationImportReceipt(context.runtime.state, receipt)
  return receipt
}

function migrationCatalogState(
  runtime: VshudCatalogImportRuntime,
  manifest: VshudMigrationManifest
): VshudMigrationCatalogState {
  const { state } = runtime
  const receipt = findVshudMigrationImportReceipt(state, manifest)
  if (receipt) {
    assertCommittedReceipt(receipt, manifest)
    return committedCatalogState(receipt)
  }
  const staged = state.vshudMigrationStagedCatalogs?.find(
    (entry) => entry.manifest.migrationId === manifest.migrationId
  )
  if (!staged) {
    return absentCatalogState(manifest)
  }
  assertSameVshudMigrationManifest(staged.manifest, manifest)
  return stagedCatalogState(manifest, staged.stagedAt, runtime)
}

// A committed receipt stays authoritative even after live rows and snapshots change.
function assertCommittedReceipt(
  receipt: VshudMigrationImportReceipt,
  manifest: VshudMigrationManifest
): void {
  if (receipt.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('vshud_migration_id_reused_with_different_manifest')
  }
  assertVshudMigrationReceiptMatchesManifest(receipt, manifest)
}

function absentCatalogState(manifest: VshudMigrationManifest): VshudMigrationCatalogState {
  return {
    state: 'absent',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256
  }
}

function stagedCatalogState(
  manifest: VshudMigrationManifest,
  stagedAt: string,
  runtime: VshudCatalogImportRuntime
): VshudMigrationCatalogState {
  const snapshotUploads = inspectVshudMigrationSnapshotUploads(
    manifest,
    runtime.terminalScrollbackSnapshotStorage
  )
  // Omit absent uploads to preserve older hosts' response shape.
  const blobUploads = inspectVshudMigrationBlobUploads(manifest, runtime.vshudMigrationBlobRoot)
  return {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt,
    ...(snapshotUploads ? { snapshotUploads } : {}),
    ...(blobUploads ? { blobUploads } : {})
  }
}

function committedCatalogState(receipt: VshudMigrationImportReceipt): VshudMigrationCatalogState {
  return {
    state: 'committed',
    migrationId: receipt.migrationId,
    manifestSha256: receipt.manifestSha256,
    receipt: structuredClone(receipt)
  }
}
