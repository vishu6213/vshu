// Export copies of relay-hosted SSH state without mutating source rows.
import {
  VSHUD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  type VshudMigrationTerminalScrollbackSnapshot
} from '../../../../../shared/vshud-migration/vshud-migration-scrollback'
import type {
  VshudMigrationCatalogPayload,
  VshudMigrationDormantStatePayload,
  VshudMigrationManifest,
  VshudMigrationManifestSource
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import { assertVshudMigrationManifestDigest } from '../../../../vshud/migration/vshud-migration-manifest-digest'
import type { StoreRuntimeState } from '../../../loading-store/store-runtime-state'
import {
  collectVshudMigrationUntransferredDependencyCensus,
  type VshudMigrationSourceDependencyCensus
} from '../sessions/vshud-source-dependency-census'
import {
  collectVshudMigrationSourceDormantState,
  type VshudMigrationSourceDormantInspection
} from '../dormancy/vshud-source-dormant-state'
import { readVshudMigrationSourceScrollbackChunk } from '../scrollback/vshud-source-scrollback-state'
import {
  createVshudMigrationDeltaView,
  type VshudMigrationDeltaView
} from './vshud-source-delta-view'
import { syncVshudMigrationScrollbackRetention } from '../scrollback/vshud-source-scrollback-retention'
import { createVshudMigrationLeaveBehindView } from './vshud-source-leave-behind-view'
import {
  collectVshudMigrationSourceDrafts,
  type VshudMigrationSourceDrafts
} from '../worktrees/vshud-source-draft-rename'

type VshudSourceExportRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

const vshudSourceExportContext = Symbol('VshudSourceExportPersistence')

export class VshudSourceExportPersistence {
  readonly [vshudSourceExportContext]: VshudSourceExportRuntime

  constructor(runtime: VshudSourceExportRuntime) {
    this[vshudSourceExportContext] = runtime
  }

  collectVshudMigrationSourceDormantState(
    source: VshudMigrationManifestSource,
    catalog: VshudMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ): VshudMigrationDormantStatePayload {
    const runtime = this[vshudSourceExportContext]
    return collectVshudMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId
    ).payload
  }

  /** The export plus what it could not carry, for a move that must refuse rather than drop rows. */
  inspectVshudMigrationSourceDormantState(
    source: VshudMigrationManifestSource,
    catalog: VshudMigrationCatalogPayload,
    destinationEnvironmentId?: string,
    daemonHistoryLeaf?: (tabId: string, leafId: string) => boolean
  ): VshudMigrationSourceDormantInspection {
    const runtime = this[vshudSourceExportContext]
    return collectVshudMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId,
      daemonHistoryLeaf
    )
  }

  collectVshudMigrationSourceDrafts(manifest: VshudMigrationManifest): VshudMigrationSourceDrafts {
    return collectVshudMigrationSourceDrafts(this[vshudSourceExportContext].state, manifest)
  }

  createVshudMigrationDeltaView(moved: VshudMigrationManifest): VshudMigrationDeltaView {
    return createVshudMigrationDeltaView(this[vshudSourceExportContext], moved)
  }

  /** Preview "Move anyway" without recording consent. */
  createVshudMigrationLeaveBehindView(targetId: string): VshudMigrationDeltaView {
    return createVshudMigrationLeaveBehindView(this[vshudSourceExportContext], targetId)
  }

  inspectVshudMigrationUntransferredDependencies(
    manifest: VshudMigrationManifest
  ): VshudMigrationSourceDependencyCensus {
    const runtime = this[vshudSourceExportContext]
    return collectVshudMigrationUntransferredDependencyCensus(
      runtime.state,
      manifest,
      runtime.terminalScrollbackSnapshotStorage
    )
  }

  /** Retain unfinished migrations' snapshots even if their tabs close. */
  syncVshudMigrationScrollbackRetention(pending: readonly VshudMigrationManifest[]): void {
    syncVshudMigrationScrollbackRetention(this[vshudSourceExportContext], pending)
  }

  /** Verify snapshot bytes against the signed manifest so changed buffers cannot be transferred. */
  readVshudMigrationSourceSnapshotChunk(
    manifest: VshudMigrationManifest,
    ref: string,
    offset: number
  ): { bytesBase64: string; totalBytes: number; eof: boolean } {
    assertVshudMigrationManifestDigest(manifest)
    const descriptor: VshudMigrationTerminalScrollbackSnapshot | undefined =
      manifest.payload.dormantState?.terminalScrollbackSnapshots?.find((entry) => entry.ref === ref)
    if (!descriptor) {
      throw new Error('vshud_migration_source_snapshot_unknown')
    }
    const runtime = this[vshudSourceExportContext]
    return readVshudMigrationSourceScrollbackChunk({
      state: runtime.state,
      descriptor,
      retained: [...runtime.retainedScrollbackRefsByMigrationId.values()].some((refs) =>
        refs.has(ref)
      ),
      offset,
      length: VSHUD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
      storage: runtime.terminalScrollbackSnapshotStorage
    })
  }
}
