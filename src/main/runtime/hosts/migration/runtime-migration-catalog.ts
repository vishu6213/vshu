import type {
  VshudMigrationCatalogAbortResult,
  VshudMigrationCatalogReference,
  VshudMigrationCatalogReferenceAbortResult,
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type {
  VshudMigrationSnapshotChunkRequest,
  VshudMigrationSnapshotChunkResult
} from '../../../../shared/vshud-migration/vshud-migration-scrollback'
import type {
  VshudMigrationBlobChunkRequest,
  VshudMigrationBlobChunkResult,
  VshudMigrationBlobDescriptor
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import {
  abortStagedVshudMigrationCatalogByReferenceDurably,
  abortStagedVshudMigrationCatalogDurably,
  commitStagedVshudMigrationCatalogDurably,
  getVshudMigrationCatalogState,
  stageVshudMigrationCatalogDurably
} from './vshud-migration-catalog-import'
import { VshuRuntimeWithResolveExitWaiters } from '../../terminal/wait/terminal-wait-settlements'
import type { RuntimeStore } from '../../construction/runtime-store-contract'

type MigrationStoreKey =
  | 'stageVshudMigrationCatalog'
  | 'commitStagedVshudMigrationCatalog'
  | 'stageVshudMigrationSnapshotChunk'
  | 'stageVshudMigrationBlobChunk'
  | 'abortStagedVshudMigrationCatalog'
  | 'abortStagedVshudMigrationCatalogByReference'
  | 'getVshudMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

export abstract class VshuRuntimeWithMigrationCatalog extends VshuRuntimeWithResolveExitWaiters {
  async stageVshudMigrationCatalog(
    manifest: VshudMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<VshudMigrationCatalogState> {
    return stageVshudMigrationCatalogDurably({
      store: this.requireMigrationStore('stageVshudMigrationCatalog', 'flushPendingOrThrowAsync'),
      manifest,
      signal: options.signal
    })
  }

  async commitStagedVshudMigrationCatalog(
    manifest: VshudMigrationManifest,
    options: {
      signal?: AbortSignal
      expectedBlobs?: readonly VshudMigrationBlobDescriptor[]
    } = {}
  ): Promise<VshudMigrationCatalogState> {
    return commitStagedVshudMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'commitStagedVshudMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal,
      expectedBlobs: options.expectedBlobs,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells,
      onDurableCommit: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }

  stageVshudMigrationSnapshotChunk(
    request: VshudMigrationSnapshotChunkRequest
  ): VshudMigrationSnapshotChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageVshudMigrationSnapshotChunk')
      .stageVshudMigrationSnapshotChunk!(request)
  }

  stageVshudMigrationBlobChunk(
    request: VshudMigrationBlobChunkRequest
  ): VshudMigrationBlobChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageVshudMigrationBlobChunk').stageVshudMigrationBlobChunk!(
      request
    )
  }

  async abortStagedVshudMigrationCatalog(
    manifest: VshudMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<VshudMigrationCatalogAbortResult> {
    return abortStagedVshudMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'abortStagedVshudMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal
    })
  }

  async abortStagedVshudMigrationCatalogByReference(
    reference: VshudMigrationCatalogReference,
    options: { signal?: AbortSignal } = {}
  ): Promise<VshudMigrationCatalogReferenceAbortResult> {
    return abortStagedVshudMigrationCatalogByReferenceDurably({
      store: this.requireMigrationStore(
        'abortStagedVshudMigrationCatalogByReference',
        'flushPendingOrThrowAsync'
      ),
      reference,
      signal: options.signal
    })
  }

  getVshudMigrationCatalogState(manifest: VshudMigrationManifest): VshudMigrationCatalogState {
    return getVshudMigrationCatalogState({
      store: this.requireMigrationStore('getVshudMigrationCatalogState'),
      manifest,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  /** Install deferred migrated history after host-shell discovery; unanswered inventory retries on the next catalog query. */
  async installPendingVshudMigrationShellHistory(): Promise<void> {
    const store = this.store
    // Every daemon start calls this; no pending blobs must cost no inventory.
    if (
      !store?.installPendingVshudMigrationReceivedBlobs ||
      !store.hasPendingVshudMigrationShellHistory?.()
    ) {
      return
    }
    // Inventory first to find restart-surviving shells; real worktrees preserve their restored orchestration receipts.
    if (
      this.ptyController?.listProcesses &&
      !(await this.refreshPtyWorktreeRecordsWithControllerInventory([
        ...(await this.getResolvedWorktreeMap()).values()
      ]))
    ) {
      console.warn('[vshud-migration] shell history waits: the terminal inventory did not answer')
      return
    }
    store.installPendingVshudMigrationReceivedBlobs({
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  override onPtyExit(
    ...args: Parameters<VshuRuntimeWithResolveExitWaiters['onPtyExit']>
  ): ReturnType<VshuRuntimeWithResolveExitWaiters['onPtyExit']> {
    const worktreeId = this.ptysById.get(args[0])?.worktreeId
    const result = super.onPtyExit(...args)
    if (worktreeId) {
      try {
        this.store?.installDeferredVshudMigrationShellHistory?.(worktreeId, {
          worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
        })
      } catch (error) {
        console.error('[vshud-migration] installing deferred shell history failed:', error)
      }
    }
    return result
  }

  // Migrated history belongs here; same-id SSH twins never write it.
  private readonly migrationWorktreeHasLiveShells = (worktreeId: string): boolean =>
    this.getLivePtyIdsForWorktree(worktreeId, undefined, { resolvedConnectionId: null }).size > 0

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
