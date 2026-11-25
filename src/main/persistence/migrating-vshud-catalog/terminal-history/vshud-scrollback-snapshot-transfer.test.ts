import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../../shared/vshu-profiles/constants'
import { VSHUD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/vshud-migration/vshud-migration-manifest-validation'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type {
  VshudMigrationSnapshotChunkRequest,
  VshudMigrationTerminalScrollbackSnapshot
} from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import {
  getTerminalScrollbackSnapshotPath,
  type TerminalScrollbackSnapshotStorage
} from '../../../pty/scrollback/terminal-scrollback-snapshots'
import {
  commitVshudMigrationSnapshots,
  stageVshudMigrationSnapshotChunk
} from './vshud-scrollback-snapshot-transfer'

let root: string
let storage: TerminalScrollbackSnapshotStorage

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vshud-migration-snapshots-'))
  storage = { snapshotRoot: join(root, 'terminal-scrollback') }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('vshud scrollback snapshot transfer', () => {
  it('rejects a same-ref content conflict before materializing any snapshot', () => {
    const firstBytes = Buffer.from('first snapshot', 'utf8')
    const secondBytes = Buffer.from('second snapshot', 'utf8')
    const first = snapshot('4', 'tab-4', 'leaf-4', firstBytes)
    const second = snapshot('5', 'tab-5', 'leaf-5', secondBytes)
    const manifest = migrationManifest('conflict', [first, second])
    const state = stagedState(manifest)
    stage(state, manifest, first, 0, firstBytes)
    stage(state, manifest, second, 0, secondBytes)
    writeFinal(second, Buffer.alloc(secondBytes.length, 0x78))

    expect(() => commitVshudMigrationSnapshots(manifest, storage)).toThrow(
      `vshud_migration_snapshot_destination_conflict:${second.ref}`
    )
    expect(readFinal(first)).toBeNull()
    expect(readFinal(second)).toEqual(Buffer.alloc(secondBytes.length, 0x78))
  })
})

function snapshot(
  suffix: string,
  tabId: string,
  leafId: string,
  bytes: Buffer
): VshudMigrationTerminalScrollbackSnapshot {
  return {
    tabId,
    leafId,
    ref: `v1-${suffix.repeat(32)}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
}

function migrationManifest(
  migrationId: string,
  snapshots: VshudMigrationTerminalScrollbackSnapshot[]
): VshudMigrationManifest {
  const workspaceSession = getDefaultWorkspaceSession()
  workspaceSession.terminalLayoutsByTabId = Object.fromEntries(
    snapshots.map((entry) => [
      entry.tabId,
      {
        root: { type: 'leaf' as const, leafId: entry.leafId },
        activeLeafId: entry.leafId,
        expandedLeafId: null,
        scrollbackRefsByLeafId: { [entry.leafId]: entry.ref }
      }
    ])
  )
  return {
    version: VSHUD_MIGRATION_MANIFEST_VERSION,
    migrationId,
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
        workspaceSession,
        terminalScrollbackSnapshots: snapshots
      }
    },
    manifestSha256: 'a'.repeat(64)
  }
}

function stagedState(...manifests: VshudMigrationManifest[]): VshudMigrationManifest[] {
  return manifests
}

function stage(
  state: VshudMigrationManifest[],
  manifest: VshudMigrationManifest,
  descriptor: VshudMigrationTerminalScrollbackSnapshot,
  offset: number,
  bytes: Buffer
) {
  const request: VshudMigrationSnapshotChunkRequest = {
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    ref: descriptor.ref,
    offset,
    bytesBase64: bytes.toString('base64')
  }
  const stagedManifest = state.find((entry) => entry.migrationId === manifest.migrationId) ?? null
  return stageVshudMigrationSnapshotChunk({ stagedManifest, storage, request })
}

function writeFinal(descriptor: VshudMigrationTerminalScrollbackSnapshot, bytes: Buffer): void {
  const path = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
  if (!path) {
    throw new Error('expected snapshot path')
  }
  if (!storage.snapshotRoot) {
    throw new Error('expected snapshot root')
  }
  mkdirSync(storage.snapshotRoot, { recursive: true })
  writeFileSync(path, bytes)
}

function readFinal(descriptor: VshudMigrationTerminalScrollbackSnapshot): Buffer | null {
  const path = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
  return path && existsSync(path) ? readFileSync(path) : null
}
