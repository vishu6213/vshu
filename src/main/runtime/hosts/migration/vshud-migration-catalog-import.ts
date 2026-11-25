import type {
  VshudMigrationCatalogAbortResult,
  VshudMigrationCatalogReference,
  VshudMigrationCatalogReferenceAbortResult,
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { VshudMigrationBlobDescriptor } from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type { Store } from '../../../persistence/loading-store/store'

/** A moved history waits while a shell runs in its worktree: that shell would overwrite it. */
type WorktreeHasLiveShells = (worktreeId: string) => boolean

type VshudMigrationCatalogFlushStore = Partial<Pick<Store, 'flushPendingOrThrowAsync'>>
type VshudMigrationCatalogStageStore = VshudMigrationCatalogFlushStore &
  Partial<Pick<Store, 'stageVshudMigrationCatalog'>>
type VshudMigrationCatalogCommitStore = VshudMigrationCatalogFlushStore &
  Partial<Pick<Store, 'commitStagedVshudMigrationCatalog' | 'installVshudMigrationReceivedBlobs'>>
type VshudMigrationCatalogAbortStore = VshudMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedVshudMigrationCatalog'>>
type VshudMigrationCatalogAbortByReferenceStore = VshudMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedVshudMigrationCatalogByReference'>>

export async function stageVshudMigrationCatalogDurably(args: {
  store: VshudMigrationCatalogStageStore
  manifest: VshudMigrationManifest
  signal?: AbortSignal
}): Promise<VshudMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.stageVshudMigrationCatalog!(args.manifest)
  await flushMigrationState(args.store, args.signal)
  return result
}

export async function commitStagedVshudMigrationCatalogDurably(args: {
  store: VshudMigrationCatalogCommitStore
  manifest: VshudMigrationManifest
  signal?: AbortSignal
  expectedBlobs?: readonly VshudMigrationBlobDescriptor[]
  onDurableCommit: () => void
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): Promise<VshudMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.commitStagedVshudMigrationCatalog!(
    args.manifest,
    args.expectedBlobs ? { expectedBlobs: args.expectedBlobs } : {}
  )
  await flushMigrationState(args.store, args.signal)
  args.onDurableCommit()
  installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  return result
}

/** After the durable commit, on its retries and state queries; the store load retries too. */
function installReceivedBlobs(
  store: Partial<Pick<Store, 'installVshudMigrationReceivedBlobs'>>,
  manifest: VshudMigrationManifest,
  worktreeHasLiveShells: WorktreeHasLiveShells | undefined
): void {
  try {
    store.installVshudMigrationReceivedBlobs?.(manifest, { worktreeHasLiveShells })
  } catch (error) {
    // The catalog is committed; a failed install keeps its blob for the next retry.
    console.error('[vshud-migration] installing received blobs failed:', error)
  }
}

export async function abortStagedVshudMigrationCatalogDurably(args: {
  store: VshudMigrationCatalogAbortStore
  manifest: VshudMigrationManifest
  signal?: AbortSignal
}): Promise<VshudMigrationCatalogAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedVshudMigrationCatalog!(args.manifest)
  // An already-absent retry may follow an in-memory abort whose flush failed.
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export async function abortStagedVshudMigrationCatalogByReferenceDurably(args: {
  store: VshudMigrationCatalogAbortByReferenceStore
  reference: VshudMigrationCatalogReference
  signal?: AbortSignal
}): Promise<VshudMigrationCatalogReferenceAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedVshudMigrationCatalogByReference!(args.reference)
  await flushMigrationState(args.store, args.signal)
  // Either answer is flushed first, so a source that cannot re-send the manifest may act on it.
  return result.state === 'absent'
    ? { ...result, durableAbsent: true }
    : { ...result, durableCommitted: true }
}

export function getVshudMigrationCatalogState(args: {
  store: Partial<
    Pick<Store, 'getVshudMigrationCatalogState' | 'installVshudMigrationReceivedBlobs'>
  >
  manifest: VshudMigrationManifest
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): VshudMigrationCatalogState {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.getVshudMigrationCatalogState!(args.manifest)
  if (result.state === 'committed') {
    installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  }
  return result
}

function flushMigrationState(
  store: VshudMigrationCatalogFlushStore,
  signal?: AbortSignal
): Promise<void> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  return store.flushPendingOrThrowAsync!({
    signal,
    drainToStableGeneration: false
  })
}
