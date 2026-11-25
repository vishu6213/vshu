import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  decodeVshudMigrationSnapshotChunk,
  type VshudMigrationSnapshotChunkRequest,
  type VshudMigrationSnapshotChunkResult,
  type VshudMigrationSnapshotUploadState,
  type VshudMigrationTerminalScrollbackSnapshot
} from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import { syncDirectoryDurablySync } from '../../../filesystem/durable-file-write'
import {
  getTerminalScrollbackSnapshotPath,
  getTerminalScrollbackSnapshotRoot,
  type TerminalScrollbackSnapshotStorage
} from '../../../pty/scrollback/terminal-scrollback-snapshots'
import {
  appendVshudMigrationStagedChunk,
  ensureVshudMigrationDirectory,
  inspectVshudMigrationFinalFile,
  linkVshudMigrationStagedFile,
  vshudMigrationFileMatches,
  vshudMigrationStagedFileSize,
  vshudMigrationStagingDirectory,
  pruneVshudMigrationStagingDirectories,
  removeVshudMigrationStagingDirectory,
  requireStagedVshudMigrationManifest
} from '../blob-transfer/vshud-migration-staged-file'

/** Only the staged manifest's snapshots may receive chunks; retried ranges must match. */
export function stageVshudMigrationSnapshotChunk(args: {
  stagedManifest: VshudMigrationManifest | null
  storage: TerminalScrollbackSnapshotStorage
  request: VshudMigrationSnapshotChunkRequest
}): VshudMigrationSnapshotChunkResult {
  const manifest = requireStagedVshudMigrationManifest(
    args.stagedManifest,
    args.request,
    'vshud_migration_snapshot_catalog_not_staged'
  )
  const descriptor = requireDescriptor(manifest, args.request.ref)
  const bytes = decodeVshudMigrationSnapshotChunk(args.request.bytesBase64)
  ensureVshudMigrationDirectory(stagingDirectory(args.storage, manifest))
  const acknowledgedOffset = appendVshudMigrationStagedChunk({
    channel: 'snapshot',
    path: stagedSnapshotPath(args.storage, manifest, descriptor),
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    ref: args.request.ref,
    acknowledgedOffset
  }
}

export function inspectVshudMigrationSnapshotUploads(
  manifest: VshudMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): VshudMigrationSnapshotUploadState[] | undefined {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return undefined
  }
  return snapshots.map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectFinalSnapshot(storage, descriptor) === 'matching'
        ? descriptor.byteLength
        : vshudMigrationStagedFileSize(
            stagedSnapshotPath(storage, manifest, descriptor),
            descriptor.byteLength
          )
  }))
}

export function assertVshudMigrationSnapshotsReady(
  manifest: VshudMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  for (const upload of inspectVshudMigrationSnapshotUploads(manifest, storage) ?? []) {
    const finalStatus = inspectFinalSnapshot(storage, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`vshud_migration_snapshot_destination_conflict:${upload.ref}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`vshud_migration_snapshot_incomplete:${upload.ref}`)
    }
    const path =
      finalStatus === 'matching'
        ? getTerminalScrollbackSnapshotPath(upload.ref, storage)
        : stagedSnapshotPath(storage, manifest, upload)
    if (!path || !vshudMigrationFileMatches(path, upload)) {
      throw new Error(`vshud_migration_snapshot_digest_mismatch:${upload.ref}`)
    }
  }
}

export function commitVshudMigrationSnapshots(
  manifest: VshudMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  assertVshudMigrationSnapshotsReady(manifest, storage)
  const root = getTerminalScrollbackSnapshotRoot(storage)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const descriptor of snapshots) {
    const finalPath = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
    if (!finalPath) {
      throw new Error('vshud_migration_snapshot_ref_invalid')
    }
    linkVshudMigrationStagedFile({
      stagedPath: stagedSnapshotPath(storage, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `vshud_migration_snapshot_destination_conflict:${descriptor.ref}`
    })
  }
  syncDirectoryDurablySync(root)
  removeVshudMigrationStagingDirectory(root, manifest)
}

export function abortVshudMigrationSnapshots(
  manifest: VshudMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  removeVshudMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

export function pruneVshudMigrationSnapshotStaging(
  stagedManifests: readonly VshudMigrationManifest[],
  storage: TerminalScrollbackSnapshotStorage
): void {
  pruneVshudMigrationStagingDirectories(getTerminalScrollbackSnapshotRoot(storage), stagedManifests)
}

function requireDescriptor(
  manifest: VshudMigrationManifest,
  ref: string
): VshudMigrationTerminalScrollbackSnapshot {
  const descriptor = manifest.payload.dormantState?.terminalScrollbackSnapshots?.find(
    (entry) => entry.ref === ref
  )
  if (!descriptor) {
    throw new Error('vshud_migration_snapshot_unknown')
  }
  return descriptor
}

function inspectFinalSnapshot(
  storage: TerminalScrollbackSnapshotStorage,
  descriptor: VshudMigrationTerminalScrollbackSnapshot
): 'absent' | 'matching' | 'conflict' {
  return inspectVshudMigrationFinalFile(
    getTerminalScrollbackSnapshotPath(descriptor.ref, storage),
    descriptor
  )
}

function stagingDirectory(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: VshudMigrationManifest
): string {
  return vshudMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

function stagedSnapshotPath(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: VshudMigrationManifest,
  descriptor: VshudMigrationTerminalScrollbackSnapshot
): string {
  return join(stagingDirectory(storage, manifest), `${descriptor.ref}.${descriptor.sha256}.part`)
}
