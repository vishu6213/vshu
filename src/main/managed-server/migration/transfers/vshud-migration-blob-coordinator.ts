/** Check every blob kind against destination capabilities before uploading. Resume from staged offsets and confirm lost acknowledgements by re-reading state; never assume delivery or silently omit unsupported data. */
import {
  VSHUD_MIGRATION_BLOB_CHUNK_BYTES,
  type VshudMigrationBlobChunkRequest,
  type VshudMigrationBlobChunkResult,
  type VshudMigrationBlobDescriptor,
  assertVshudMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  vshudMigrationBlobIdentity,
  vshudMigrationBlobKindUnsupportedBlocker,
  sameVshudMigrationBlob
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type {
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'

export type VshudMigrationBlobSource = {
  /** Return the descriptor's exact hashed bytes at offset, up to maxBytes. */
  readChunk: (
    descriptor: VshudMigrationBlobDescriptor,
    offset: number,
    maxBytes: number
  ) => Promise<Buffer>
}

export type VshudMigrationBlobDestination = {
  readCapabilities: () => Promise<readonly string[]>
  readState: (manifest: VshudMigrationManifest) => Promise<VshudMigrationCatalogState>
  stageChunk: (request: VshudMigrationBlobChunkRequest) => Promise<VshudMigrationBlobChunkResult>
}

/** Serve exported bytes, refusing any descriptor they were not exported as. */
export function exportedVshudMigrationBlobSource(
  blobs: readonly { descriptor: VshudMigrationBlobDescriptor; bytes: Buffer }[]
): VshudMigrationBlobSource {
  return {
    readChunk: async (descriptor, offset, maxBytes) => {
      const blob = blobs.find((entry) => sameVshudMigrationBlob(entry.descriptor, descriptor))
      if (!blob) {
        throw new Error(`vshud_migration_source_blob_changed:${descriptor.blobKind}`)
      }
      return blob.bytes.subarray(offset, offset + maxBytes)
    }
  }
}

type VshudMigrationBlobTransfer = {
  source: VshudMigrationBlobSource
  manifest: VshudMigrationManifest
  blobs: readonly VshudMigrationBlobDescriptor[]
  destination: VshudMigrationBlobDestination
}

type StagedCatalogState = Extract<VshudMigrationCatalogState, { state: 'staged' }>

export async function transferVshudMigrationBlobs(
  transfer: VshudMigrationBlobTransfer
): Promise<void> {
  if (transfer.blobs.length === 0) {
    return
  }
  assertVshudMigrationBlobSet(transfer.blobs)
  const unsupported = findUnsupportedMigrationBlobKind(
    transfer.blobs,
    await transfer.destination.readCapabilities()
  )
  if (unsupported) {
    throw new Error(vshudMigrationBlobKindUnsupportedBlocker(unsupported))
  }
  const offsets = receivedOffsets(transfer, await readStagedState(transfer))
  for (const blob of transfer.blobs) {
    let offset = offsets.get(vshudMigrationBlobIdentity(blob)) ?? 0
    while (offset < blob.byteLength) {
      const bytes = await transfer.source.readChunk(
        blob,
        offset,
        Math.min(VSHUD_MIGRATION_BLOB_CHUNK_BYTES, blob.byteLength - offset)
      )
      if (
        bytes.length === 0 ||
        bytes.length > VSHUD_MIGRATION_BLOB_CHUNK_BYTES ||
        offset + bytes.length > blob.byteLength
      ) {
        throw new Error(`vshud_migration_source_blob_changed:${blob.blobKind}`)
      }
      const request: VshudMigrationBlobChunkRequest = {
        migrationId: transfer.manifest.migrationId,
        manifestSha256: transfer.manifest.manifestSha256,
        blob: { ...blob },
        offset,
        bytesBase64: bytes.toString('base64')
      }
      offset = await stageChunkWithRecovery(transfer, request, offset + bytes.length)
    }
  }
  assertAllReceived(transfer, await readStagedState(transfer))
}

async function readStagedState(transfer: VshudMigrationBlobTransfer): Promise<StagedCatalogState> {
  const state = await transfer.destination.readState(transfer.manifest)
  if (state.state !== 'staged') {
    throw new Error('vshud_migration_blob_catalog_not_staged')
  }
  return state
}

function receivedOffsets(
  transfer: VshudMigrationBlobTransfer,
  state: StagedCatalogState
): Map<string, number> {
  const wanted = new Map(transfer.blobs.map((blob) => [vshudMigrationBlobIdentity(blob), blob]))
  const offsets = new Map<string, number>()
  for (const upload of state.blobUploads ?? []) {
    const blob = wanted.get(vshudMigrationBlobIdentity(upload))
    // A reused key with different bytes is another capture; restaging would mix them.
    if (!blob || !sameVshudMigrationBlob(blob, upload)) {
      throw new Error(`vshud_migration_blob_descriptor_conflict:${upload.blobKind}`)
    }
    offsets.set(vshudMigrationBlobIdentity(upload), upload.receivedBytes)
  }
  return offsets
}

function assertAllReceived(transfer: VshudMigrationBlobTransfer, state: StagedCatalogState): void {
  const received = receivedOffsets(transfer, state)
  for (const blob of transfer.blobs) {
    if (received.get(vshudMigrationBlobIdentity(blob)) !== blob.byteLength) {
      throw new Error(`vshud_migration_blob_transfer_incomplete:${blob.blobKind}`)
    }
  }
}

async function stageChunkWithRecovery(
  transfer: VshudMigrationBlobTransfer,
  request: VshudMigrationBlobChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await transfer.destination.stageChunk(request)
    if (result.receivedBytes !== expectedOffset) {
      throw new Error('vshud_migration_blob_ack_invalid')
    }
    return result.receivedBytes
  } catch (error) {
    try {
      const observed = await transfer.destination.readState(transfer.manifest)
      const received =
        observed.state === 'staged'
          ? observed.blobUploads?.find(
              (entry) =>
                vshudMigrationBlobIdentity(entry) === vshudMigrationBlobIdentity(request.blob)
            )?.receivedBytes
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
