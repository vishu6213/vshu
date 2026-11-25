import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../vshu-profiles/constants'
import {
  assertVshudMigrationScrollbackReferences,
  parseVshudMigrationSnapshotChunkResult,
  parseVshudMigrationTerminalScrollbackSnapshots,
  type VshudMigrationSnapshotChunkRequest,
  type VshudMigrationTerminalScrollbackSnapshot
} from './vshud-migration-scrollback'

const DIGEST = 'a'.repeat(64)

describe('vshud migration scrollback wire validation', () => {
  it('requires an acknowledgment for exactly the decoded chunk length', () => {
    const request = chunkRequest(Buffer.from('abc').toString('base64'), 7)
    expect(
      parseVshudMigrationSnapshotChunkResult(
        {
          migrationId: request.migrationId,
          manifestSha256: request.manifestSha256,
          ref: request.ref,
          acknowledgedOffset: 10
        },
        request
      ).acknowledgedOffset
    ).toBe(10)
    for (const acknowledgedOffset of [7, 9, 11]) {
      expect(() =>
        parseVshudMigrationSnapshotChunkResult(
          {
            migrationId: request.migrationId,
            manifestSha256: request.manifestSha256,
            ref: request.ref,
            acknowledgedOffset
          },
          request
        )
      ).toThrow('vshud_migration_snapshot_chunk_result_invalid')
    }
  })

  it('requires unique refs and tab/leaf identities', () => {
    const first = descriptor(1)
    expect(() =>
      parseVshudMigrationTerminalScrollbackSnapshots([first, { ...descriptor(2), ref: first.ref }])
    ).toThrow('vshud_migration_dormant_scrollback_snapshot_ref_duplicate')
    expect(() =>
      parseVshudMigrationTerminalScrollbackSnapshots([
        first,
        { ...descriptor(2), tabId: first.tabId, leafId: first.leafId }
      ])
    ).toThrow('vshud_migration_dormant_scrollback_snapshot_leaf_duplicate')
  })

  it('requires one exact descriptor for every published session ref', () => {
    const session = getDefaultWorkspaceSession()
    const first = descriptor(1)
    session.terminalLayoutsByTabId = {
      [first.tabId]: {
        root: { type: 'leaf', leafId: first.leafId },
        activeLeafId: first.leafId,
        expandedLeafId: null,
        scrollbackRefsByLeafId: { [first.leafId]: first.ref }
      }
    }
    expect(() => assertVshudMigrationScrollbackReferences(session, [first])).not.toThrow()
    expect(() => assertVshudMigrationScrollbackReferences(session, [])).toThrow(
      'vshud_migration_dormant_scrollback_reference_invalid'
    )
    expect(() =>
      assertVshudMigrationScrollbackReferences(session, [{ ...first, ref: descriptor(2).ref }])
    ).toThrow('vshud_migration_dormant_scrollback_reference_invalid')
    expect(() => assertVshudMigrationScrollbackReferences(session, [first, descriptor(2)])).toThrow(
      'vshud_migration_dormant_scrollback_reference_invalid'
    )
  })
})

function chunkRequest(bytesBase64: string, offset = 0): VshudMigrationSnapshotChunkRequest {
  return {
    migrationId: 'migration-1',
    manifestSha256: DIGEST,
    ref: `v1-${'1'.repeat(32)}`,
    offset,
    bytesBase64
  }
}

function descriptor(index: number): VshudMigrationTerminalScrollbackSnapshot {
  const identity = index.toString(16).padStart(32, '0')
  return {
    tabId: `tab-${index}`,
    leafId: `leaf-${index}`,
    ref: `v1-${identity}`,
    sha256: index.toString(16).padStart(64, '0'),
    byteLength: 1
  }
}
