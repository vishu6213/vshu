import type { VshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  VSHUD_MIGRATION_DEPENDENCY_KINDS,
  type VshudMigrationDependencyKind
} from '../../../../../shared/vshud-migration/vshud-migration-preflight'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import type { TerminalScrollbackSnapshotStorage } from '../../../../pty/scrollback/terminal-scrollback-snapshots'
import {
  inspectVshudMigrationSourceSessions,
  type VshudMigrationSourceSessionInspection
} from './vshud-source-session-dependencies'
import {
  collectVshudMigrationSourceDormantState,
  vshudMigrationLeavesBehind
} from '../dormancy/vshud-source-dormant-state'
import {
  createVshudMigrationSourceScope,
  vshudMigrationOwnerMatchesScope,
  vshudMigrationPartitionScope,
  type VshudMigrationSourceScope
} from '../catalog/vshud-source-scope'
import { paneBelongsToTabs } from '../../../../../shared/workspace-session/workspace-session-pane-ownership'

export type VshudMigrationSourceDependencyCensus = {
  totalCount: number
  counts: Record<VshudMigrationDependencyKind, number>
  /** Blocker names and remedies where available. */
  names?: Partial<Record<VshudMigrationDependencyKind, string[]>>
}

export function collectVshudMigrationUntransferredDependencyCensus(
  state: PersistedState,
  manifest: VshudMigrationManifest,
  storage?: TerminalScrollbackSnapshotStorage
): VshudMigrationSourceDependencyCensus {
  const scope = createVshudMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const sessions = inspectVshudMigrationSourceSessions(state, {
    hostId: scope.hostId,
    ownerMatches: (ownerKey, partitionHostId) =>
      vshudMigrationOwnerMatchesScope(
        ownerKey,
        vshudMigrationPartitionScope(scope, partitionHostId)
      )
  })
  const dormant = collectVshudMigrationSourceDormantState(
    state,
    manifest.source,
    manifest.payload,
    storage,
    manifest.destinationEnvironmentId
  )
  const counts: Record<VshudMigrationDependencyKind, number> = {
    ...dormant.blockedCounts,
    'terminal-lease': state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId === scope.targetId && lease.state !== 'terminated'
    ).length,
    // Retained recoveries can stay behind; the terminal gate still requires exit.
    'terminal-recovery': vshudMigrationLeavesBehind(state, scope.targetId)
      ? 0
      : countTerminalRecoveryState(state, scope, sessions)
  }
  return {
    counts,
    totalCount: VSHUD_MIGRATION_DEPENDENCY_KINDS.reduce((total, kind) => total + counts[kind], 0),
    names: {
      ...(dormant.blockedSessionItems.length > 0
        ? { 'workspace-session': dormant.blockedSessionItems }
        : {}),
      ...(dormant.runningAutomationItems.length > 0
        ? { 'automation-run': dormant.runningAutomationItems }
        : {})
    }
  }
}

// The terminal gate proves recovery leases exited; hook aliases add no independent terminal ownership.
function countTerminalRecoveryState(
  state: PersistedState,
  scope: VshudMigrationSourceScope,
  sessions: VshudMigrationSourceSessionInspection
): number {
  return state.migrationUnsupportedPtyEntries.filter(
    (entry) =>
      vshudMigrationOwnerMatchesScope(entry.worktreeId, scope) ||
      (entry.tabId ? sessions.tabIds.has(entry.tabId) : false) ||
      sessions.ptyIds.has(entry.ptyId) ||
      (entry.paneKey ? paneBelongsToTabs(entry.paneKey, sessions.tabIds) : false)
  ).length
}
