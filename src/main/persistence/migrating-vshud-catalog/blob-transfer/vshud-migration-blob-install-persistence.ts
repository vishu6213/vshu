import { VSHUD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { PersistedState } from '../../../../shared/vshu-profiles/persisted-state-types'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { getDaemonHistoryDir } from '../../../daemon/launch/daemon-launch-paths'
import { getHistoryRoot } from '../../../pty/history/terminal-history-paths'
import type { StoreRuntimeState } from '../../loading-store/store-runtime-state'
import {
  findVshudMigrationImportReceipt,
  isVshudMigrationCommitDurable
} from '../catalog-commit/vshud-catalog-receipt-ledger'
import { installVshudMigrationReceivedBlobs } from './vshud-migration-blob-installers'
import { listVshudMigrationReceivedBlobNames } from './vshud-migration-blob-staging'
import type { VshudMigrationRequestIdentity } from './vshud-migration-staged-file'

type VshudMigrationBlobInstallRuntime = Pick<
  StoreRuntimeState,
  | 'state'
  | 'vshudMigrationBlobRoot'
  | 'vshudTerminalRestoreHints'
  | 'paneShellPath'
  | 'deferredShellHistoryWorktreeIds'
  | 'writeGeneration'
  | 'lastDurableWriteGeneration'
  | 'vshudMigrationCommitWriteGenerations'
>

type ClockOptions = { now?: () => Date }
type InstallOptions = ClockOptions & {
  /** Defer history installation while shells run in its worktree. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
}

const vshudMigrationBlobInstallContext = Symbol('VshudMigrationBlobInstallPersistence')
type VshudMigrationBlobInstallContext = {
  runtime: VshudMigrationBlobInstallRuntime
}

export class VshudMigrationBlobInstallPersistence {
  readonly [vshudMigrationBlobInstallContext]: VshudMigrationBlobInstallContext

  constructor(runtime: VshudMigrationBlobInstallRuntime) {
    this[vshudMigrationBlobInstallContext] = { runtime }
  }

  /** Wait for durable commit or a restart could lose both the catalog and its consumed blobs. */
  installVshudMigrationReceivedBlobs(
    manifest: VshudMigrationManifest,
    options: InstallOptions = {}
  ): void {
    const receipt = findVshudMigrationImportReceipt(
      this[vshudMigrationBlobInstallContext].runtime.state,
      manifest
    )
    if (receipt?.manifestSha256 !== manifest.manifestSha256) {
      return
    }
    installCommitted(this[vshudMigrationBlobInstallContext].runtime, manifest, options)
  }

  /** Recover interrupted installs; disk-loaded receipts already prove durability. */
  installPendingVshudMigrationReceivedBlobs(options: InstallOptions = {}): void {
    const { runtime } = this[vshudMigrationBlobInstallContext]
    for (const receipt of [
      ...(runtime.state.vshudMigrationImportReceipts ?? []),
      ...(runtime.state.vshudMigrationEvictedReceipts ?? [])
    ]) {
      try {
        installCommitted(runtime, receipt, options)
      } catch (error) {
        console.error(
          `[vshud-migration] installing received blobs for ${receipt.migrationId} failed:`,
          error
        )
      }
    }
  }

  /** Only the runtime installs pending shell history. */
  hasPendingVshudMigrationShellHistory(): boolean {
    const { runtime } = this[vshudMigrationBlobInstallContext]
    return [
      ...(runtime.state.vshudMigrationImportReceipts ?? []),
      ...(runtime.state.vshudMigrationEvictedReceipts ?? [])
    ].some((receipt) =>
      listVshudMigrationReceivedBlobNames(
        runtime.vshudMigrationBlobRoot,
        receipt,
        'shell-history'
      ).some((key) => VSHUD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].key.test(key))
    )
  }

  installDeferredVshudMigrationShellHistory(
    worktreeId: string,
    options: InstallOptions = {}
  ): void {
    const { runtime } = this[vshudMigrationBlobInstallContext]
    if (runtime.deferredShellHistoryWorktreeIds.has(worktreeId)) {
      this.installPendingVshudMigrationReceivedBlobs(options)
    }
  }

  /** Read without consuming. */
  peekVshudMigrationTerminalRestoreHint(
    paneKey: string,
    worktreeId: string,
    options: ClockOptions = {}
  ): string | null {
    return this[vshudMigrationBlobInstallContext].runtime.vshudTerminalRestoreHints.peek(
      paneKey,
      worktreeId,
      clock(options)
    )
  }

  /** Consume after spawn, even if it used a different cwd. */
  consumeVshudMigrationTerminalRestoreHint(paneKey: string, options: ClockOptions = {}): void {
    this[vshudMigrationBlobInstallContext].runtime.vshudTerminalRestoreHints.consume(
      paneKey,
      clock(options)
    )
  }
}

function installCommitted(
  runtime: VshudMigrationBlobInstallRuntime,
  migration: VshudMigrationRequestIdentity,
  options: InstallOptions
): void {
  if (!isVshudMigrationCommitDurable(runtime, migration)) {
    return
  }
  installVshudMigrationReceivedBlobs({
    migration,
    root: runtime.vshudMigrationBlobRoot,
    terminalRestoreHints: runtime.vshudTerminalRestoreHints,
    shellHistoryRoot: getHistoryRoot(),
    terminalHistoryRoot: getDaemonHistoryDir(),
    paneShellPath: () => runtime.paneShellPath(runtime.state.settings?.terminalDefaultShell),
    worktreeHasLiveShells: options.worktreeHasLiveShells,
    deferredShellHistoryWorktreeIds: runtime.deferredShellHistoryWorktreeIds,
    paneWorktreeId: (paneKey) => findPaneWorktreeId(runtime.state, paneKey),
    workspacePath: (worktreeId) => findWorkspacePath(runtime.state, worktreeId),
    now: clock(options)
  })
}

function clock(options: ClockOptions): number {
  return (options.now ?? (() => new Date()))().getTime()
}

// A git worktree id carries its path; a folder workspace's is on its record.
function findWorkspacePath(state: PersistedState, worktreeId: string): string | null {
  const separator = worktreeId.indexOf('::')
  if (separator > 0) {
    return worktreeId.slice(separator + 2) || null
  }
  return state.folderWorkspaces.find((folder) => folder.id === worktreeId)?.folderPath ?? null
}

// The commit merged the moved session in with its worktree ids unchanged.
function findPaneWorktreeId(state: PersistedState, paneKey: string): string | null {
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!tabId) {
    return null
  }
  const sessions = [state.workspaceSession, ...Object.values(state.workspaceSessionsByHostId ?? {})]
  for (const session of sessions) {
    for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
      if (tabs.some((tab) => tab.id === tabId)) {
        return worktreeId
      }
    }
  }
  return null
}
