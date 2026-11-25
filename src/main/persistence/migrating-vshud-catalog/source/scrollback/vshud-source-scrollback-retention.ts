import type { VshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import type { StoreRuntimeState } from '../../../loading-store/store-runtime-state'
import {
  readTerminalScrollbackStoredBytesSync,
  writeTerminalScrollbackSnapshotSync
} from '../../../../pty/scrollback/terminal-scrollback-snapshots'
import { deleteUnreferencedVshudMigrationScrollback } from './vshud-source-scrollback-cleanup'
import {
  findSnapshotBytes,
  matchesVshudMigrationSnapshotBytes
} from './vshud-source-scrollback-state'

type RetentionRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

/** Persist signed snapshots until commit/abandonment so tab closes cannot break transfer retries. */
export function syncVshudMigrationScrollbackRetention(
  runtime: RetentionRuntime,
  pending: readonly VshudMigrationManifest[]
): void {
  const held = runtime.retainedScrollbackRefsByMigrationId
  const pendingIds = new Set(pending.map((manifest) => manifest.migrationId))
  const released = [...held].filter(([migrationId]) => !pendingIds.has(migrationId))
  for (const manifest of pending) {
    if (held.has(manifest.migrationId)) {
      continue
    }
    const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
    for (const descriptor of snapshots) {
      persistInlineSnapshot(runtime, descriptor)
    }
    held.set(manifest.migrationId, new Set(snapshots.map((snapshot) => snapshot.ref)))
  }
  for (const [migrationId] of released) {
    held.delete(migrationId)
  }
  deleteUnreferencedVshudMigrationScrollback(
    runtime,
    released.flatMap(([, refs]) => [...refs])
  )
}

function persistInlineSnapshot(
  runtime: RetentionRuntime,
  descriptor: NonNullable<
    NonNullable<VshudMigrationManifest['payload']['dormantState']>['terminalScrollbackSnapshots']
  >[number]
): void {
  const storage = runtime.terminalScrollbackSnapshotStorage
  // A newer inline copy (local-only park) can supersede a file under the same ref; keep what was signed.
  const stored = readTerminalScrollbackStoredBytesSync(descriptor.ref, storage)
  if (matchesVshudMigrationSnapshotBytes(stored, descriptor)) {
    return
  }
  const bytes = findSnapshotBytes(runtime.state, descriptor, storage)
  if (bytes) {
    writeTerminalScrollbackSnapshotSync({
      tabId: descriptor.tabId,
      leafId: descriptor.leafId,
      buffer: bytes.toString('utf8'),
      storage
    })
  }
}
