// Fsync staged appends, verify retried ranges, and commit digest-checked files by hard link.
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { syncDirectoryDurablySync } from '../../../filesystem/durable-file-write'

export const VSHUD_MIGRATION_STAGING_DIRECTORY = '.vshud-migration-staging'

/** Selects error codes such as vshud_migration_<channel>_offset_invalid. */
export type VshudMigrationStagingChannel = 'snapshot' | 'blob'

export type VshudMigrationRequestIdentity = { migrationId: string; manifestSha256: string }

export type VshudMigrationStagedContent = { sha256: string; byteLength: number }

export type VshudMigrationStagedChunk = {
  channel: VshudMigrationStagingChannel
  path: string
  offset: number
  bytes: Buffer
  byteLength: number
}

/** Retried ranges must match; returns staged size. */
export function appendVshudMigrationStagedChunk(chunk: VshudMigrationStagedChunk): number {
  const { channel, path, offset, bytes } = chunk
  const descriptorFd = openStagedFile(path)
  try {
    const size = statSync(path).size
    if (offset > size || offset + bytes.length > chunk.byteLength) {
      throw new Error(`vshud_migration_${channel}_offset_invalid`)
    }
    if (offset < size) {
      if (offset + bytes.length > size) {
        throw new Error(`vshud_migration_${channel}_offset_invalid`)
      }
      const existing = Buffer.alloc(bytes.length)
      const read = readSync(descriptorFd, existing, 0, existing.length, offset)
      if (read !== bytes.length || !existing.equals(bytes)) {
        throw new Error(`vshud_migration_${channel}_retry_mismatch`)
      }
      return size
    }
    const written = writeSync(descriptorFd, bytes, 0, bytes.length, offset)
    if (written !== bytes.length) {
      throw new Error(`vshud_migration_${channel}_write_incomplete`)
    }
    fsyncSync(descriptorFd)
    return size + bytes.length
  } finally {
    closeSync(descriptorFd)
  }
}

export function vshudMigrationStagedFileSize(path: string, byteLength: number): number {
  try {
    return Math.min(statSync(path).size, byteLength)
  } catch {
    return 0
  }
}

export function vshudMigrationFileMatches(
  path: string,
  expected: VshudMigrationStagedContent
): boolean {
  try {
    const bytes = readFileSync(path)
    return (
      bytes.length === expected.byteLength &&
      createHash('sha256').update(bytes).digest('hex') === expected.sha256
    )
  } catch {
    return false
  }
}

export function inspectVshudMigrationFinalFile(
  path: string | null,
  expected: VshudMigrationStagedContent
): 'absent' | 'matching' | 'conflict' {
  if (!path || !existsSync(path)) {
    return 'absent'
  }
  return vshudMigrationFileMatches(path, expected) ? 'matching' : 'conflict'
}

/** An identical final file makes a retried hard-link commit succeed; different bytes refuse. */
export function linkVshudMigrationStagedFile(args: {
  stagedPath: string
  finalPath: string
  expected: VshudMigrationStagedContent
  conflictError: string
}): void {
  if (inspectVshudMigrationFinalFile(args.finalPath, args.expected) !== 'matching') {
    try {
      linkSync(args.stagedPath, args.finalPath)
    } catch (error) {
      const finalStatus = inspectVshudMigrationFinalFile(args.finalPath, args.expected)
      if (finalStatus === 'conflict') {
        throw new Error(args.conflictError)
      }
      if (finalStatus !== 'matching') {
        throw error
      }
    }
  }
  rmSync(args.stagedPath, { force: true })
}

export function vshudMigrationStagingDirectory(
  root: string,
  manifest: VshudMigrationManifest
): string {
  return join(root, VSHUD_MIGRATION_STAGING_DIRECTORY, vshudMigrationStagingKey(manifest))
}

export function ensureVshudMigrationDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
}

export function removeVshudMigrationStagingDirectory(
  root: string,
  manifest: VshudMigrationManifest
): void {
  rmSync(vshudMigrationStagingDirectory(root, manifest), { recursive: true, force: true })
  syncDirectoryDurablySync(join(root, VSHUD_MIGRATION_STAGING_DIRECTORY))
}

export function pruneVshudMigrationStagingDirectories(
  root: string,
  stagedManifests: readonly VshudMigrationManifest[]
): void {
  pruneVshudMigrationKeyedDirectories(
    join(root, VSHUD_MIGRATION_STAGING_DIRECTORY),
    stagedManifests
  )
}

export function pruneVshudMigrationKeyedDirectories(
  parent: string,
  retainedMigrations: readonly VshudMigrationRequestIdentity[]
): void {
  const retained = new Set(retainedMigrations.map(vshudMigrationStagingKey))
  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return
  }
  for (const entry of entries) {
    if (/^[a-f0-9]{32}$/.test(entry) && !retained.has(entry)) {
      rmSync(join(parent, entry), { recursive: true, force: true })
    }
  }
}

/** Refuse through the channel's error if its staged manifest does not match. */
export function requireStagedVshudMigrationManifest(
  staged: VshudMigrationManifest | null,
  request: VshudMigrationRequestIdentity,
  notStagedError: string
): VshudMigrationManifest {
  if (
    !staged ||
    staged.migrationId !== request.migrationId ||
    staged.manifestSha256 !== request.manifestSha256
  ) {
    throw new Error(notStagedError)
  }
  return staged
}

export function vshudMigrationStagingKey(manifest: VshudMigrationRequestIdentity): string {
  return createHash('sha256')
    .update(`${manifest.migrationId}\0${manifest.manifestSha256}`)
    .digest('hex')
    .slice(0, 32)
}

function openStagedFile(path: string): number {
  try {
    return openSync(path, 'r+')
  } catch {
    try {
      return openSync(path, 'wx+', 0o600)
    } catch {
      return openSync(path, 'r+')
    }
  }
}
