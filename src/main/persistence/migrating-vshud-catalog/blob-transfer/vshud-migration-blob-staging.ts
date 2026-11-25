// The manifest omits blobs; descriptor filenames make staged uploads resumable after restart.
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  VSHUD_MIGRATION_BLOB_KINDS,
  assertVshudMigrationBlobSet,
  decodeVshudMigrationBlobChunk,
  vshudMigrationBlobIdentity,
  parseVshudMigrationBlobDescriptor,
  sameVshudMigrationBlob,
  type VshudMigrationBlobChunkRequest,
  type VshudMigrationBlobChunkResult,
  type VshudMigrationBlobDescriptor,
  type VshudMigrationBlobKind,
  type VshudMigrationBlobUploadState
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { syncDirectoryDurablySync } from '../../../filesystem/durable-file-write'
import {
  appendVshudMigrationStagedChunk,
  ensureVshudMigrationDirectory,
  inspectVshudMigrationFinalFile,
  linkVshudMigrationStagedFile,
  vshudMigrationFileMatches,
  vshudMigrationStagedFileSize,
  vshudMigrationStagingDirectory,
  vshudMigrationStagingKey,
  pruneVshudMigrationKeyedDirectories,
  pruneVshudMigrationStagingDirectories,
  removeVshudMigrationStagingDirectory,
  requireStagedVshudMigrationManifest,
  type VshudMigrationRequestIdentity
} from './vshud-migration-staged-file'

const RECEIVED_DIRECTORY = 'received'
const STAGED_BLOB_NAME = /^([^.]+)\.([a-f0-9]{64})\.([1-9][0-9]*)\.part$/

type VshudMigrationBlobName = Pick<VshudMigrationBlobDescriptor, 'blobKind' | 'key'>

type ReceivedBlobPathResolver = (
  root: string,
  manifest: VshudMigrationRequestIdentity,
  descriptor: VshudMigrationBlobName
) => string

const receivedDirectoryPath: ReceivedBlobPathResolver = (root, manifest, descriptor) =>
  join(receivedBlobsDirectory(root, manifest), descriptor.blobKind, descriptor.key)

const RECEIVED_BLOB_DESTINATIONS: Record<VshudMigrationBlobKind, ReceivedBlobPathResolver> = {
  'terminal-restore-hints': receivedDirectoryPath,
  'shell-history': receivedDirectoryPath,
  'agent-session-records': receivedDirectoryPath,
  'terminal-history': receivedDirectoryPath,
  'automation-run-history': receivedDirectoryPath
}

export function getVshudMigrationReceivedBlobPath(
  root: string,
  manifest: VshudMigrationRequestIdentity,
  descriptor: VshudMigrationBlobName
): string {
  return RECEIVED_BLOB_DESTINATIONS[descriptor.blobKind](root, manifest, descriptor)
}

export function listVshudMigrationReceivedBlobNames(
  root: string,
  manifest: VshudMigrationRequestIdentity,
  blobKind: VshudMigrationBlobKind
): string[] {
  return readDirectory(join(receivedBlobsDirectory(root, manifest), blobKind))
}

export type VshudMigrationBlobChunkStaging = {
  stagedManifest: VshudMigrationManifest | null
  root: string
  request: VshudMigrationBlobChunkRequest
}

export function stageVshudMigrationBlobChunk(
  args: VshudMigrationBlobChunkStaging
): VshudMigrationBlobChunkResult {
  const manifest = requireStagedVshudMigrationManifest(
    args.stagedManifest,
    args.request,
    'vshud_migration_blob_catalog_not_staged'
  )
  const descriptor = parseVshudMigrationBlobDescriptor(args.request.blob)
  const bytes = decodeVshudMigrationBlobChunk(args.request.bytesBase64)
  const staged = stagedBlobDescriptors(args.root, manifest)
  const existing = staged.find(
    (entry) => vshudMigrationBlobIdentity(entry) === vshudMigrationBlobIdentity(descriptor)
  )
  if (existing && !sameVshudMigrationBlob(existing, descriptor)) {
    // Replacing staged bytes requires abort and restage.
    throw new Error(`vshud_migration_blob_descriptor_conflict:${descriptor.blobKind}`)
  }
  if (!existing) {
    assertVshudMigrationBlobSet([...staged, descriptor])
  }
  const path = stagedBlobPath(args.root, manifest, descriptor)
  ensureVshudMigrationDirectory(dirname(path))
  const receivedBytes = appendVshudMigrationStagedChunk({
    channel: 'blob',
    path,
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    blobKind: descriptor.blobKind,
    key: descriptor.key,
    receivedBytes
  }
}

export function inspectVshudMigrationBlobUploads(
  manifest: VshudMigrationManifest,
  root: string
): VshudMigrationBlobUploadState[] | undefined {
  const uploads = stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectReceivedBlob(root, manifest, descriptor) === 'matching'
        ? descriptor.byteLength
        : vshudMigrationStagedFileSize(
            stagedBlobPath(root, manifest, descriptor),
            descriptor.byteLength
          )
  }))
  return uploads.length > 0 ? uploads : undefined
}

export function assertVshudMigrationBlobsReady(
  manifest: VshudMigrationManifest,
  root: string
): void {
  for (const upload of inspectVshudMigrationBlobUploads(manifest, root) ?? []) {
    const label = `${upload.blobKind}:${upload.key}`
    const finalStatus = inspectReceivedBlob(root, manifest, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`vshud_migration_blob_destination_conflict:${label}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`vshud_migration_blob_incomplete:${label}`)
    }
    if (
      finalStatus !== 'matching' &&
      !vshudMigrationFileMatches(stagedBlobPath(root, manifest, upload), upload)
    ) {
      throw new Error(`vshud_migration_blob_digest_mismatch:${label}`)
    }
  }
}

/** Verified staged files; call after assertVshudMigrationBlobsReady in the same synchronous turn. */
export function stagedVshudMigrationBlobFiles(
  manifest: VshudMigrationManifest,
  root: string
): { descriptor: VshudMigrationBlobDescriptor; path: string }[] {
  return stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    descriptor,
    path: stagedBlobPath(root, manifest, descriptor)
  }))
}

/** A blob's verified bytes, staged or already moved to received by an earlier commit attempt. */
export function readVshudMigrationBlob(
  manifest: VshudMigrationManifest,
  root: string,
  descriptor: VshudMigrationBlobDescriptor
): Buffer {
  for (const path of [
    stagedBlobPath(root, manifest, descriptor),
    getVshudMigrationReceivedBlobPath(root, manifest, descriptor)
  ]) {
    if (vshudMigrationFileMatches(path, descriptor)) {
      return readFileSync(path)
    }
  }
  throw new Error(`vshud_migration_blob_incomplete:${descriptor.blobKind}:${descriptor.key}`)
}

/** Reject missing or extra blobs, including leftovers from another capture. */
export function assertVshudMigrationBlobSetMatches(
  manifest: VshudMigrationManifest,
  root: string,
  expected: readonly VshudMigrationBlobDescriptor[]
): void {
  assertVshudMigrationBlobSet(expected)
  const wanted = new Map(expected.map((entry) => [vshudMigrationBlobIdentity(entry), entry]))
  const staged = stagedBlobDescriptors(root, manifest)
  const stagedIds = new Set(staged.map(vshudMigrationBlobIdentity))
  for (const descriptor of staged) {
    const match = wanted.get(vshudMigrationBlobIdentity(descriptor))
    if (!match || !sameVshudMigrationBlob(match, descriptor)) {
      throw blobSetMismatch(descriptor)
    }
  }
  for (const identity of receivedBlobIdentities(root, manifest)) {
    if (!wanted.has(identity)) {
      throw new Error('vshud_migration_blob_set_mismatch')
    }
  }
  for (const descriptor of expected) {
    // Previous commit attempts may have moved these bytes to received.
    if (
      !stagedIds.has(vshudMigrationBlobIdentity(descriptor)) &&
      inspectReceivedBlob(root, manifest, descriptor) !== 'matching'
    ) {
      throw blobSetMismatch(descriptor)
    }
  }
}

/** Call assertVshudMigrationBlobsReady in the same synchronous turn so no chunk can change verified bytes. */
export function commitVshudMigrationBlobs(manifest: VshudMigrationManifest, root: string): void {
  const directories = new Set<string>()
  for (const descriptor of stagedBlobDescriptors(root, manifest)) {
    const finalPath = getVshudMigrationReceivedBlobPath(root, manifest, descriptor)
    ensureVshudMigrationDirectory(dirname(finalPath))
    linkVshudMigrationStagedFile({
      stagedPath: stagedBlobPath(root, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `vshud_migration_blob_destination_conflict:${descriptor.blobKind}:${descriptor.key}`
    })
    directories.add(dirname(finalPath))
  }
  for (const directory of directories) {
    syncDirectoryDurablySync(directory)
  }
  removeVshudMigrationStagingDirectory(root, manifest)
}

/** Also remove blobs moved by a commit that never landed. */
export function abortVshudMigrationBlobs(manifest: VshudMigrationManifest, root: string): void {
  removeVshudMigrationStagingDirectory(root, manifest)
  rmSync(receivedBlobsDirectory(root, manifest), { recursive: true, force: true })
}

export function pruneVshudMigrationBlobStaging(
  stagedManifests: readonly VshudMigrationManifest[],
  committedMigrations: readonly VshudMigrationRequestIdentity[],
  root: string
): void {
  pruneVshudMigrationStagingDirectories(root, stagedManifests)
  pruneVshudMigrationKeyedDirectories(join(root, RECEIVED_DIRECTORY), [
    ...stagedManifests,
    ...committedMigrations
  ])
}

function blobSetMismatch(descriptor: VshudMigrationBlobDescriptor): Error {
  return new Error(`vshud_migration_blob_set_mismatch:${descriptor.blobKind}:${descriptor.key}`)
}

function receivedBlobIdentities(root: string, manifest: VshudMigrationManifest): string[] {
  const received = receivedBlobsDirectory(root, manifest)
  return VSHUD_MIGRATION_BLOB_KINDS.flatMap((blobKind) =>
    readDirectory(join(received, blobKind)).map((key) =>
      vshudMigrationBlobIdentity({ blobKind, key })
    )
  )
}

function stagedBlobDescriptors(
  root: string,
  manifest: VshudMigrationManifest
): VshudMigrationBlobDescriptor[] {
  const staging = vshudMigrationStagingDirectory(root, manifest)
  const descriptors: VshudMigrationBlobDescriptor[] = []
  for (const blobKind of VSHUD_MIGRATION_BLOB_KINDS) {
    for (const name of readDirectory(join(staging, blobKind))) {
      const match = STAGED_BLOB_NAME.exec(name)
      if (!match) {
        continue
      }
      try {
        descriptors.push(
          parseVshudMigrationBlobDescriptor({
            blobKind,
            key: match[1],
            sha256: match[2],
            byteLength: Number(match[3])
          })
        )
      } catch {
        // Foreign names cannot belong to the staged set.
      }
    }
  }
  return descriptors
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function inspectReceivedBlob(
  root: string,
  manifest: VshudMigrationManifest,
  descriptor: VshudMigrationBlobDescriptor
): 'absent' | 'matching' | 'conflict' {
  return inspectVshudMigrationFinalFile(
    getVshudMigrationReceivedBlobPath(root, manifest, descriptor),
    descriptor
  )
}

function receivedBlobsDirectory(root: string, manifest: VshudMigrationRequestIdentity): string {
  return join(root, RECEIVED_DIRECTORY, vshudMigrationStagingKey(manifest))
}

function stagedBlobPath(
  root: string,
  manifest: VshudMigrationManifest,
  descriptor: VshudMigrationBlobDescriptor
): string {
  return join(
    vshudMigrationStagingDirectory(root, manifest),
    descriptor.blobKind,
    `${descriptor.key}.${descriptor.sha256}.${descriptor.byteLength}.part`
  )
}
