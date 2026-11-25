import { parseVshudMigrationSnapshotChunkResult } from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import type {
  VshudMigrationSnapshotChunkRequest,
  VshudMigrationSnapshotChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-scrollback'

import {
  findUnsupportedMigrationBlobKind,
  vshudMigrationBlobKindUnsupportedBlocker,
  parseVshudMigrationBlobChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'

import type {
  VshudMigrationBlobChunkRequest,
  VshudMigrationBlobChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'

import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import type { CatalogRequestOptions } from '../catalog/vshud-migration-request'
import { sendSupportedMigrationRequest } from '../catalog/vshud-migration-request'

export async function stageRemoteVshudMigrationSnapshotChunk(
  pairingCode: string,
  request: VshudMigrationSnapshotChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<VshudMigrationSnapshotChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('vshud_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'vshud.migration.stageSnapshotChunk',
    request,
    options
  )
  if (!response.ok) {
    throw new Error(`vshud_migration_snapshot_failed:${response.error.message}`)
  }
  return parseVshudMigrationSnapshotChunkResult(response.result, request)
}

export async function stageRemoteVshudMigrationBlobChunk(
  pairingCode: string,
  request: VshudMigrationBlobChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<VshudMigrationBlobChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('vshud_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'vshud.migration.stageBlobChunk',
    request,
    options,
    false,
    null,
    // Recheck every request so a downgraded destination cannot stage an unsupported blob kind.
    (capabilities) => {
      const unsupported = findUnsupportedMigrationBlobKind([request.blob], capabilities)
      if (unsupported) {
        throw new Error(vshudMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`vshud_migration_blob_failed:${response.error.message}`)
  }
  return parseVshudMigrationBlobChunkResult(response.result, request)
}
