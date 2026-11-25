/** Keep source authority until durable destination commit. Verify the fenced export before stage/commit; resolve lost replies by catalog reads and persist journal transitions before returning. Never release a committed destination. */
import type {
  VshudMigrationCatalogAbortResult,
  VshudMigrationCatalogReference,
  VshudMigrationCatalogReferenceAbortResult,
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type {
  VshudMigrationSnapshotChunkRequest,
  VshudMigrationSnapshotChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import type {
  VshudMigrationBlobChunkRequest,
  VshudMigrationBlobChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type {
  VshudMigrationSourceCutover,
  VshudMigrationSourceCutoverPhase
} from '../../../../shared/vshud-migration/vshud-migration-source-cutover'
import { resolveDurableVshudCatalogMutation } from './vshud-catalog-durable-mutation'
import { VSHUD_MIGRATION_DESTINATION_UNSUPPORTED } from '../catalog/vshud-migration-request'
import { vshudMigrationRequestFits } from '../catalog/vshud-migration-request-budget'
import {
  listVshudMigrationSourceCutovers,
  writeVshudMigrationSourceCutover
} from '../../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import type { VshudMigrationSourceCutoverPort } from './vshud-migration-source'
import {
  transferVshudMigrationSnapshots,
  type VshudMigrationSnapshotSource
} from '../transfers/vshud-migration-snapshot-coordinator'
import {
  exportedVshudMigrationBlobSource,
  transferVshudMigrationBlobs
} from '../transfers/vshud-migration-blob-coordinator'
import type { VshudMigrationExportedBlob } from '../../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import type { VshudMigrationPreflightStore } from '../../../ssh/targets/ssh-target-vshud-preflight'
import { sshRelayMigrationCutoverPort } from '../../../ssh/migration-source/vshud-migration-ssh-relay-source'
import type { SshTargetVshudClaims } from '../../../ssh/targets/ssh-target-vshud-claims'

export type VshudMigrationDestinationCatalog = {
  readState: (manifest: VshudMigrationManifest) => Promise<VshudMigrationCatalogState>
  stage: (manifest: VshudMigrationManifest) => Promise<VshudMigrationCatalogState>
  commit: (manifest: VshudMigrationManifest) => Promise<VshudMigrationCatalogState>
  abort: (manifest: VshudMigrationManifest) => Promise<VshudMigrationCatalogAbortResult>
  /** Use identity-only abort when the journal's full manifest cannot fit a request. */
  abortByReference: (
    manifest: VshudMigrationCatalogReference
  ) => Promise<VshudMigrationCatalogReferenceAbortResult>
  stageChunk: (
    request: VshudMigrationSnapshotChunkRequest
  ) => Promise<VshudMigrationSnapshotChunkResult>
  /** Read fresh before blobs are sent: each blob kind needs its own capability. */
  readCapabilities: () => Promise<readonly string[]>
  stageBlobChunk: (
    request: VshudMigrationBlobChunkRequest
  ) => Promise<VshudMigrationBlobChunkResult>
}

export type VshudMigrationCutoverContext = {
  userDataPath: string
  store: VshudMigrationPreflightStore & VshudMigrationSnapshotSource
  claims: SshTargetVshudClaims
  destination: VshudMigrationDestinationCatalog
  /** Rebuild copied stores for each check so concurrent edits remain visible. */
  freshSource?: () => VshudMigrationPreflightStore
  /** The fenced source; defaults to the relay-era SSH target the journal names. */
  source?: VshudMigrationSourceCutoverPort
  now?: () => Date
}

function cutoverSource(context: VshudMigrationCutoverContext): VshudMigrationSourceCutoverPort {
  return context.source ?? sshRelayMigrationCutoverPort(context)
}

export async function stageVshudMigrationDestination(
  context: VshudMigrationCutoverContext,
  migrationId: string
): Promise<VshudMigrationSourceCutover> {
  let cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return cutover
  }
  const blobs = assertSourceUnchanged(context, cutover)
  const { destination } = context
  const read = await destination.readState(cutover.manifest)
  const state =
    read.state === 'committed'
      ? await confirmDurableCommit(destination, cutover.manifest)
      : await resolveDurableVshudCatalogMutation(
          () => destination.stage(cutover.manifest),
          () => destination.readState(cutover.manifest),
          (observed) => observed.state !== 'absent'
        )
  cutover = recordObservedState(context, cutover, state)
  if (state.state === 'staged') {
    await transferVshudMigrationSnapshots({
      source: context.store,
      manifest: cutover.manifest,
      state,
      destination: { readState: destination.readState, stageChunk: destination.stageChunk }
    })
    await transferVshudMigrationBlobs({
      source: exportedVshudMigrationBlobSource(blobs),
      manifest: cutover.manifest,
      blobs: blobs.map((blob) => blob.descriptor),
      destination: {
        readCapabilities: destination.readCapabilities,
        readState: destination.readState,
        stageChunk: destination.stageBlobChunk
      }
    })
  }
  return cutover
}

export async function commitVshudMigrationDestination(
  context: VshudMigrationCutoverContext,
  migrationId: string
): Promise<VshudMigrationSourceCutover> {
  const staged = await stageVshudMigrationDestination(context, migrationId)
  if (staged.phase !== 'destination-staged') {
    return staged
  }
  assertSourceUnchanged(context, staged)
  const { destination } = context
  // A lost commit reply may hide success; catalog read decides the next step.
  const state = await resolveDurableVshudCatalogMutation(
    () => destination.commit(staged.manifest),
    () => destination.readState(staged.manifest),
    (observed) => observed.state === 'committed'
  )
  if (state.state !== 'committed') {
    throw new Error(`vshud_migration_commit_not_committed:${state.state}`)
  }
  return recordObservedState(context, staged, state)
}

export type VshudMigrationAbortResult =
  | { outcome: 'released'; evidence: 'catalog-absent' | 'destination-unsupported' }
  | { outcome: 'refused'; code: string; reason: string }

/** Release only on proven destination absence; default drops journal/fence, while delta moves retain the fence. */
export async function abortVshudMigrationCutover(
  context: VshudMigrationCutoverContext,
  migrationId: string,
  release: (cutover: VshudMigrationSourceCutover) => Promise<void> = (cutover) =>
    cutoverSource(context).releaseFence(cutover)
): Promise<VshudMigrationAbortResult> {
  const cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return committedRefusal()
  }
  const { destination } = context
  // Older journals can hold oversized manifests; identity-only abort must still release them.
  if (!vshudMigrationRequestFits({ manifest: cutover.manifest })) {
    const aborted = await destination.abortByReference(cutover.manifest)
    if (aborted.state === 'committed') {
      return committedRefusal()
    }
    await release(cutover)
    return { outcome: 'released', evidence: 'catalog-absent' }
  }
  let state: VshudMigrationCatalogState
  try {
    state = await destination.readState(cutover.manifest)
  } catch (error) {
    // Unsupported proves absence only before any stage could have landed.
    if (isDestinationUnsupported(error) && cutover.phase === 'source-fenced') {
      await release(cutover)
      return { outcome: 'released', evidence: 'destination-unsupported' }
    }
    throw error
  }
  if (state.state !== 'committed') {
    state = await abortWithRecovery(destination, cutover.manifest)
  }
  if (state.state === 'committed') {
    recordObservedState(context, cutover, await confirmDurableCommit(destination, cutover.manifest))
    return committedRefusal()
  }
  if (state.state !== 'absent') {
    throw new Error(`vshud_migration_abort_not_absent:${state.state}`)
  }
  await release(cutover)
  return { outcome: 'released', evidence: 'catalog-absent' }
}

/** Committed reads may be unflushed memory; require the idempotent commit acknowledgement to prove durability. */
export async function confirmDurableCommit(
  destination: VshudMigrationDestinationCatalog,
  manifest: VshudMigrationManifest
): Promise<VshudMigrationCatalogState> {
  const state = await destination.commit(manifest)
  if (state.state !== 'committed') {
    throw new Error(`vshud_migration_commit_not_committed:${state.state}`)
  }
  return state
}

function assertSourceUnchanged(
  context: VshudMigrationCutoverContext,
  cutover: VshudMigrationSourceCutover
): VshudMigrationExportedBlob[] {
  return cutoverSource(context).verifyFence(cutover)
}

/** Persist observed state before returning. */
function recordObservedState(
  context: VshudMigrationCutoverContext,
  cutover: VshudMigrationSourceCutover,
  state: VshudMigrationCatalogState
): VshudMigrationSourceCutover {
  if (state.state === 'absent') {
    throw new Error('vshud_migration_destination_catalog_absent')
  }
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('vshud_migration_destination_state_mismatch')
  }
  if (
    state.state === 'committed' &&
    (state.receipt.migrationId !== cutover.migrationId ||
      state.receipt.manifestSha256 !== cutover.manifestSha256)
  ) {
    throw new Error('vshud_migration_destination_receipt_mismatch')
  }
  const phase: VshudMigrationSourceCutoverPhase =
    state.state === 'committed' ? 'destination-committed' : 'destination-staged'
  if (phase === cutover.phase) {
    return cutover
  }
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    // Never regress a proven commit.
    return cutover
  }
  const next: VshudMigrationSourceCutover = {
    ...cutover,
    phase,
    updatedAt: (context.now ?? (() => new Date()))().toISOString()
  }
  writeVshudMigrationSourceCutover(context.userDataPath, next)
  return next
}

/** Aborts staging; a failed abort is decided by a re-read, never assumed. */
export async function abortWithRecovery(
  destination: VshudMigrationDestinationCatalog,
  manifest: VshudMigrationManifest
): Promise<VshudMigrationCatalogState> {
  try {
    return await destination.abort(manifest)
  } catch (abortError) {
    try {
      const observed = await destination.readState(manifest)
      if (observed.state === 'committed') {
        return observed
      }
      if (observed.state === 'absent') {
        // Absent reads may predate flush; repeat abort to prove durable absence.
        return await destination.abort(manifest)
      }
    } catch {
      // Keep the original failure and fence while abort remains unverifiable.
    }
    throw abortError
  }
}

function requireCutover(userDataPath: string, migrationId: string): VshudMigrationSourceCutover {
  const cutover = listVshudMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (!cutover) {
    throw new Error('vshud_migration_source_cutover_not_found')
  }
  return cutover
}

function committedRefusal(): VshudMigrationAbortResult {
  return {
    outcome: 'refused',
    code: 'vshud_migration_committed_source_cannot_be_released',
    reason: 'This host’s Vshu server already holds this migration; it can only move forward.'
  }
}

function isDestinationUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message === VSHUD_MIGRATION_DESTINATION_UNSUPPORTED
}
