/** Read snapshot chunks from source storage and verify manifest length/digest. Resume from destination offsets; re-read after lost acknowledgements instead of assuming delivery. This transport-independent driver retires nothing. */
import type {
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  decodeVshudMigrationSnapshotChunk,
  type VshudMigrationSnapshotChunkRequest,
  type VshudMigrationSnapshotChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import type { Store } from '../../../persistence/loading-store/store'

export type VshudMigrationSnapshotSource = Pick<Store, 'readVshudMigrationSourceSnapshotChunk'>

type VshudMigrationSnapshotDestination = {
  readState: (manifest: VshudMigrationManifest) => Promise<VshudMigrationCatalogState>
  stageChunk: (
    request: VshudMigrationSnapshotChunkRequest
  ) => Promise<VshudMigrationSnapshotChunkResult>
}

export async function transferVshudMigrationSnapshots(args: {
  source: VshudMigrationSnapshotSource
  manifest: VshudMigrationManifest
  state: Extract<VshudMigrationCatalogState, { state: 'staged' }>
  destination: VshudMigrationSnapshotDestination
}): Promise<void> {
  const snapshots = args.manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return
  }
  // Journal retention keeps bytes available after tab close, including retries.
  await sendSnapshots(args, snapshots)
}

async function sendSnapshots(
  args: Parameters<typeof transferVshudMigrationSnapshots>[0],
  snapshots: NonNullable<
    NonNullable<VshudMigrationManifest['payload']['dormantState']>['terminalScrollbackSnapshots']
  >
): Promise<void> {
  const offsets = new Map(
    (args.state.snapshotUploads ?? []).map((entry) => [entry.ref, entry.receivedBytes])
  )
  for (const snapshot of snapshots) {
    let offset = offsets.get(snapshot.ref)
    if (offset === undefined) {
      throw new Error('vshud_migration_snapshot_transfer_unsupported')
    }
    while (offset < snapshot.byteLength) {
      const chunk = args.source.readVshudMigrationSourceSnapshotChunk(
        args.manifest,
        snapshot.ref,
        offset
      )
      if (chunk.totalBytes !== snapshot.byteLength || !chunk.bytesBase64) {
        throw new Error('vshud_migration_source_snapshot_changed')
      }
      const request: VshudMigrationSnapshotChunkRequest = {
        migrationId: args.manifest.migrationId,
        manifestSha256: args.manifest.manifestSha256,
        ref: snapshot.ref,
        offset,
        bytesBase64: chunk.bytesBase64
      }
      const expectedOffset = offset + decodeVshudMigrationSnapshotChunk(chunk.bytesBase64).length
      offset = await stageChunkWithRecovery(args, request, expectedOffset)
    }
  }
  const verified = await args.destination.readState(args.manifest)
  if (
    verified.state !== 'staged' ||
    (verified.snapshotUploads ?? []).length !== snapshots.length ||
    (verified.snapshotUploads ?? []).some((entry) => entry.receivedBytes !== entry.byteLength)
  ) {
    throw new Error('vshud_migration_snapshot_transfer_incomplete')
  }
}

async function stageChunkWithRecovery(
  args: { manifest: VshudMigrationManifest; destination: VshudMigrationSnapshotDestination },
  request: VshudMigrationSnapshotChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await args.destination.stageChunk(request)
    if (result.acknowledgedOffset !== expectedOffset) {
      throw new Error('vshud_migration_snapshot_ack_invalid')
    }
    return result.acknowledgedOffset
  } catch (error) {
    try {
      const observed = await args.destination.readState(args.manifest)
      const received =
        observed.state === 'staged'
          ? observed.snapshotUploads?.find((entry) => entry.ref === request.ref)?.receivedBytes
          : undefined
      if (received === expectedOffset) {
        return received
      }
    } catch {
      // Unverifiable chunks retain the original failure.
    }
    throw error
  }
}
