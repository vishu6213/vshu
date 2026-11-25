// Validate blob contents before commit; install only advertised kinds after durable commit.
import { servesWslMovedPaneHistory } from '../../../vshud/migration/vshud-migration-wsl-destination'
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { VshudMigrationBlobKind } from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  parseVshudMigrationTerminalRestoreHintsText,
  type VshudMigrationTerminalRestoreHint
} from '../../../../shared/vshud-migration/vshud-migration-terminal-restore-hints'
import { syncDirectoryDurablySync } from '../../../filesystem/durable-file-write'
import {
  getVshudMigrationReceivedBlobPath,
  stagedVshudMigrationBlobFiles
} from './vshud-migration-blob-staging'
import {
  vshudMigrationStagingKey,
  type VshudMigrationRequestIdentity
} from './vshud-migration-staged-file'
import {
  assertVshudMigrationShellHistoryValid,
  installVshudMigrationShellHistory
} from '../terminal-history/vshud-shell-history-installer'
import {
  assertVshudMigrationTerminalHistoryValid,
  installVshudMigrationTerminalHistory
} from '../terminal-history/vshud-terminal-history-installer'
import type {
  VshudTerminalRestoreHintPlacement,
  VshudTerminalRestoreHintStore
} from '../terminal-history/vshud-terminal-restore-hint-store'

type VshudMigrationStagedBlobFile = {
  key: string
  path: string
  manifest: VshudMigrationManifest
}

type VshudMigrationBlobContentCheck = (file: VshudMigrationStagedBlobFile) => void

const UTF8 = new TextDecoder('utf-8', { fatal: true })

const BLOB_CONTENT_CHECKS: Partial<Record<VshudMigrationBlobKind, VshudMigrationBlobContentCheck>> =
  {
    'terminal-restore-hints': ({ path }) => {
      parseVshudMigrationTerminalRestoreHintsText(decodeUtf8(readFileSync(path)))
    },
    'shell-history': ({ key, path, manifest }) => {
      assertVshudMigrationShellHistoryValid(key, path, manifest.payload)
    },
    'terminal-history': ({ key, path, manifest }) => {
      assertVshudMigrationTerminalHistoryValid(key, path, manifest)
    }
  }

/** Reject malformed content before commit while the source still owns everything. */
export function assertVshudMigrationBlobContentsValid(
  manifest: VshudMigrationManifest,
  root: string
): void {
  for (const { descriptor, path } of stagedVshudMigrationBlobFiles(manifest, root)) {
    const check = BLOB_CONTENT_CHECKS[descriptor.blobKind]
    if (!check) {
      continue
    }
    try {
      check({ key: descriptor.key, path, manifest })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`vshud_migration_blob_content_invalid:${descriptor.blobKind}:${reason}`)
    }
  }
}

export type VshudMigrationBlobInstall = {
  migration: VshudMigrationRequestIdentity
  root: string
  terminalRestoreHints: VshudTerminalRestoreHintStore
  /** This host's getHistoryRoot(). */
  shellHistoryRoot: string
  /** This host's `getDaemonHistoryDir()`, where its terminals' checkpoints live. */
  terminalHistoryRoot: string
  /** The shell binary a new pane on this host would actually run. */
  paneShellPath: () => string
  /** Defer without runtime evidence: shells surviving a restart could overwrite installed history. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
  deferredShellHistoryWorktreeIds: Set<string>
  paneWorktreeId: (paneKey: string) => string | null
  /** The workspace's folder on this host, or null when it is not here. */
  workspacePath: (worktreeId: string) => string | null
  now: number
}

/** Retain failed blobs for retry; installed-migration markers prevent consumed hints from reviving. */
export function installVshudMigrationReceivedBlobs(install: VshudMigrationBlobInstall): void {
  let firstError: unknown = null
  // Keep failures independent so other blob kinds can still install.
  for (const installKind of [
    installTerminalRestoreHints,
    installShellHistory,
    installTerminalHistory,
    removeImportedAutomationRunHistory
  ]) {
    try {
      installKind(install)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== null) {
    throw firstError
  }
}

// The durable commit already holds these runs; the blob only served that commit.
function removeImportedAutomationRunHistory(install: VshudMigrationBlobInstall): void {
  rmSync(
    getVshudMigrationReceivedBlobPath(install.root, install.migration, {
      blobKind: 'automation-run-history',
      key: 'migration'
    }),
    { force: true }
  )
}

function installTerminalHistory(install: VshudMigrationBlobInstall): void {
  // Only a WSL host advertises terminal history, so no other destination should hold any.
  if (!servesWslMovedPaneHistory()) {
    return
  }
  installVshudMigrationTerminalHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.terminalHistoryRoot,
    paneWorktreeId: install.paneWorktreeId,
    workspacePath: install.workspacePath,
    now: install.now
  })
}

function installShellHistory(install: VshudMigrationBlobInstall): void {
  if (!install.worktreeHasLiveShells) {
    return
  }
  installVshudMigrationShellHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.shellHistoryRoot,
    paneShellPath: install.paneShellPath,
    worktreeHasLiveShells: install.worktreeHasLiveShells,
    deferredWorktreeIds: install.deferredShellHistoryWorktreeIds,
    now: install.now
  })
}

function installTerminalRestoreHints(install: VshudMigrationBlobInstall): void {
  const path = getVshudMigrationReceivedBlobPath(install.root, install.migration, {
    blobKind: 'terminal-restore-hints',
    key: VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY
  })
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return
  }
  const migrationKey = vshudMigrationStagingKey(install.migration)
  if (!install.terminalRestoreHints.hasInstalledMigration(migrationKey)) {
    try {
      const document = parseVshudMigrationTerminalRestoreHintsText(decodeUtf8(bytes))
      install.terminalRestoreHints.install(
        { migrationKey, migrationId: install.migration.migrationId },
        placeHints(document.hints, install.paneWorktreeId),
        install.now
      )
    } catch (error) {
      if (!isHintFormatError(error)) {
        throw error
      }
      // Pre-commit validation passed; damaged hints can only fall back to the default folder now.
      console.error(
        `[vshud-migration] dropped unreadable terminal restore hints for ${install.migration.migrationId}:`,
        error
      )
    }
  }
  rmSync(path, { force: true })
  syncDirectoryDurablySync(dirname(path))
}

// Drop hints whose panes have no worktree on this host.
function placeHints(
  hints: readonly VshudMigrationTerminalRestoreHint[],
  paneWorktreeId: (paneKey: string) => string | null
): VshudTerminalRestoreHintPlacement[] {
  return hints.flatMap((hint) => {
    const worktreeId = paneWorktreeId(hint.paneKey)
    return worktreeId ? [{ ...hint, worktreeId }] : []
  })
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('vshud_migration_terminal_restore_hints_not_utf8')
  }
}

function isHintFormatError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('vshud_migration_terminal_restore_')
}
