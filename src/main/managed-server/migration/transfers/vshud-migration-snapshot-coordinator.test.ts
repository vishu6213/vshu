import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VSHUD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/vshud-migration/vshud-migration-manifest-validation'
import type {
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { VshudMigrationTerminalScrollbackSnapshot } from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import { transferVshudMigrationSnapshots } from './vshud-migration-snapshot-coordinator'

const BYTES = Buffer.from('resume these bytes', 'utf8')
const SNAPSHOT: VshudMigrationTerminalScrollbackSnapshot = {
  tabId: 'tab-1',
  leafId: 'leaf-1',
  ref: `v1-${'1'.repeat(32)}`,
  sha256: createHash('sha256').update(BYTES).digest('hex'),
  byteLength: BYTES.length
}
const MANIFEST: VshudMigrationManifest = {
  version: VSHUD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
  payload: {
    repositories: [],
    projectGroups: [],
    folderWorkspaces: [],
    dormantState: {
      version: 1,
      worktreeMeta: [],
      worktreeLineage: [],
      workspaceLineage: [],
      sparsePresets: [],
      retiredWorktreeNames: [],
      retiredWorktreeNamespaces: [],
      terminalScrollbackSnapshots: [SNAPSHOT]
    }
  },
  manifestSha256: 'a'.repeat(64)
}
type ChunkReader = (
  manifest: VshudMigrationManifest,
  ref: string,
  offset: number
) => { bytesBase64: string; totalBytes: number; eof: boolean }

function source(read: ChunkReader) {
  return {
    readVshudMigrationSourceSnapshotChunk: read
  }
}

const unreachableRead: ChunkReader = () => {
  throw new Error('must not read')
}

describe('vshud migration snapshot coordinator', () => {
  it('refuses a snapshot whose source length changed since export', async () => {
    await expect(
      transferVshudMigrationSnapshots({
        source: source(() => ({
          bytesBase64: Buffer.from('changed').toString('base64'),
          totalBytes: BYTES.length + 1,
          eof: true
        })),
        manifest: MANIFEST,
        state: staged(0),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => staged(0)
        }
      })
    ).rejects.toThrow('vshud_migration_source_snapshot_changed')
  })

  it('requires complete upload evidence after the final chunk', async () => {
    const remoteReads = [staged(BYTES.length - 1)]
    await expect(
      transferVshudMigrationSnapshots({
        source: source(unreachableRead),
        manifest: MANIFEST,
        state: staged(BYTES.length),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => nextState(remoteReads)
        }
      })
    ).rejects.toThrow('vshud_migration_snapshot_transfer_incomplete')
  })
})

function staged(receivedBytes?: number): Extract<VshudMigrationCatalogState, { state: 'staged' }> {
  return {
    state: 'staged',
    migrationId: MANIFEST.migrationId,
    manifestSha256: MANIFEST.manifestSha256,
    stagedAt: '2026-08-30T12:01:00.000Z',
    ...(receivedBytes === undefined ? {} : { snapshotUploads: [{ ...SNAPSHOT, receivedBytes }] })
  }
}

function nextState(
  states: Extract<VshudMigrationCatalogState, { state: 'staged' }>[]
): Extract<VshudMigrationCatalogState, { state: 'staged' }> {
  const state = states.shift()
  if (!state) {
    throw new Error('unexpected remote read')
  }
  return state
}
