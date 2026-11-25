import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  VSHUD_MIGRATION_BLOB_CHUNK_BYTES,
  type VshudMigrationBlobDescriptor
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { getVshudMigrationReceivedBlobPath } from './vshud-migration-blob-staging'
import {
  commitStagedVshudMigrationCatalogDurably,
  getVshudMigrationCatalogState
} from '../../../runtime/hosts/migration/vshud-migration-catalog-import'
import {
  DORMANT_LEAF_ID,
  DORMANT_WORKTREE_ID,
  dormantState,
  manifest
} from '../catalog-commit/persistence-vshud-migration-catalog-fixture'
import { createStore, readDataFile, testState, writeDataFile } from '../../persistence-test-harness'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../../../telemetry/client', () => ({ track: vi.fn() }))

type Store = ReturnType<typeof createStore>

const HINTED_PANE = `tab-dormant:${DORMANT_LEAF_ID}`

function encodeHints(cwd: string): { bytes: Buffer; descriptor: VshudMigrationBlobDescriptor } {
  const bytes = Buffer.from(JSON.stringify({ version: 1, hints: [{ paneKey: HINTED_PANE, cwd }] }))
  return {
    bytes,
    descriptor: {
      blobKind: 'terminal-restore-hints',
      key: 'migration',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length
    }
  }
}

function receivedHintsPath(input: VshudMigrationManifest): string {
  return getVshudMigrationReceivedBlobPath(join(testState.dir, 'vshud-migration-blobs'), input, {
    blobKind: 'terminal-restore-hints',
    key: 'migration'
  })
}

function hint(store: Store): string | null {
  return store.peekVshudMigrationTerminalRestoreHint(HINTED_PANE, DORMANT_WORKTREE_ID)
}

function commitDurably(store: Store, input: VshudMigrationManifest) {
  return commitStagedVshudMigrationCatalogDurably({
    store,
    manifest: input,
    onDurableCommit: () => {}
  })
}

async function stageHints(store: Store) {
  const hints = encodeHints('/home/me/src')
  const base = manifest()
  const input = manifest({ payload: { ...base.payload, dormantState: dormantState() } })
  store.stageVshudMigrationCatalog(input)
  for (let offset = 0; offset < hints.bytes.length; offset += VSHUD_MIGRATION_BLOB_CHUNK_BYTES) {
    store.stageVshudMigrationBlobChunk({
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      blob: hints.descriptor,
      offset,
      bytesBase64: hints.bytes
        .subarray(offset, offset + VSHUD_MIGRATION_BLOB_CHUNK_BYTES)
        .toString('base64')
    })
  }
  await store.flushPendingOrThrowAsync()
  return { input, expectedBlobs: [hints.descriptor], stagedDisk: readDataFile() }
}

async function commitWithFailedFlush(store: Store, input: VshudMigrationManifest) {
  vi.spyOn(store, 'flushPendingOrThrowAsync').mockRejectedValueOnce(new Error('disk full'))
  await expect(commitDurably(store, input)).rejects.toThrow('disk full')
}

describe('vshud migration received blobs wait for a durable commit', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'vshu-migration-blobs-durable-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('keeps the received blob through a failed flush and state query, for retry after reloading the stage', async () => {
    const store = createStore()
    const { input, expectedBlobs, stagedDisk } = await stageHints(store)
    await commitWithFailedFlush(store, input)

    // An in-memory commit receipt cannot authorize consuming blobs before durability.
    expect(getVshudMigrationCatalogState({ store, manifest: input }).state).toBe('committed')
    expect(existsSync(receivedHintsPath(input))).toBe(true)
    expect(hint(store)).toBeNull()

    writeDataFile(stagedDisk)
    const restarted = createStore()
    expect(restarted.getVshudMigrationCatalogState(input).state).toBe('staged')
    const result = await commitStagedVshudMigrationCatalogDurably({
      store: restarted,
      manifest: input,
      expectedBlobs,
      onDurableCommit: () => {}
    })
    expect(result.state).toBe('committed')
    expect(hint(restarted)).toBe('/home/me/src')
    expect(existsSync(receivedHintsPath(input))).toBe(false)
  })

  it('installs the blob when a same-process retry flushes the commit', async () => {
    const store = createStore()
    const { input, expectedBlobs } = await stageHints(store)
    await commitWithFailedFlush(store, input)

    const retried = await commitStagedVshudMigrationCatalogDurably({
      store,
      manifest: input,
      expectedBlobs,
      onDurableCommit: () => {}
    })
    expect(retried.state).toBe('committed')
    expect(existsSync(receivedHintsPath(input))).toBe(false)
    expect(hint(store)).toBe('/home/me/src')
  })
})
