import type { WorkspaceSessionState } from '../../../../../shared/workspace-session/workspace-session-state-types'
import { markdownFileIdCandidates } from '../../../../vshu-profiles/project-transfer/profile-session-markdown-transfer'
import { removeWorkspaceSessionOwners } from '../../../restoring-sessions/session-owner-removal'
import {
  createVshudMigrationSourceScope,
  vshudMigrationOwnerMatchesScope,
  vshudMigrationOwnsRepoId,
  vshudMigrationPartitionScope,
  type VshudMigrationSourceScope
} from '../catalog/vshud-source-scope'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../../shared/execution-host/execution-host'
import { collectSessionOwnerKeys } from './vshud-source-workspace-session-fragments'
import type { VshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'

/** Mutate a delta-view copy only. */
export function subtractVshudMigrationSourceWorkspaceSession(
  state: PersistedState,
  manifest: VshudMigrationManifest
): void {
  if (!manifest.payload.dormantState?.workspaceSession) {
    return
  }
  subtractVshudMigrationScopeWorkspaceSession(state, manifest)
}

/** Include scoped session state that earlier migrations could not carry. */
export function subtractVshudMigrationScopeWorkspaceSession(
  state: PersistedState,
  manifest: VshudMigrationManifest
): void {
  const scope = createVshudMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  state.workspaceSession = removeOwnedSessionState(
    state.workspaceSession,
    vshudMigrationPartitionScope(scope, LOCAL_EXECUTION_HOST_ID)
  )
  const partitions = state.workspaceSessionsByHostId
  if (partitions) {
    state.workspaceSessionsByHostId = Object.fromEntries(
      Object.entries(partitions).map(([hostId, session]) => [
        hostId,
        session
          ? removeOwnedSessionState(session, vshudMigrationPartitionScope(scope, hostId))
          : session
      ])
    )
  }
}

function removeOwnedSessionState(
  session: WorkspaceSessionState,
  scope: VshudMigrationSourceScope
): WorkspaceSessionState {
  const ownerKeys = new Set(
    [...collectSessionOwnerKeys(session)].filter((ownerKey) =>
      vshudMigrationOwnerMatchesScope(ownerKey, scope)
    )
  )
  const removedMarkdownFileIds = new Set<string>()
  for (const [ownerKey, files] of Object.entries(session.openFilesByWorktree ?? {})) {
    if (!vshudMigrationOwnerMatchesScope(ownerKey, scope)) {
      continue
    }
    for (const file of files) {
      markdownFileIdCandidates(file.filePath, ownerKey, file.runtimeEnvironmentId).forEach((id) =>
        removedMarkdownFileIds.add(id)
      )
    }
  }
  // Destination focus names the same IDs and must survive source subtraction.
  const retargetedFocus = isVshudRuntimeHostFocus(session)
    ? {
        activeRepoId: session.activeRepoId,
        activeWorktreeId: session.activeWorktreeId,
        activeWorkspaceKey: session.activeWorkspaceKey,
        activeTabId: session.activeTabId
      }
    : null
  const next = removeWorkspaceSessionOwners(session, ownerKeys) ?? session
  // Selection-only sessions and canonical keys also need scoped subtraction.
  const retired = next === session ? structuredClone(session) : next
  if (retargetedFocus) {
    Object.assign(retired, retargetedFocus)
  } else {
    if (vshudMigrationOwnsRepoId(scope, retired.activeRepoId)) {
      retired.activeRepoId = null
    }
    if (vshudMigrationOwnerMatchesScope(retired.activeWorktreeId, scope)) {
      retired.activeWorktreeId = null
    }
    if (vshudMigrationOwnerMatchesScope(retired.activeWorkspaceKey, scope)) {
      retired.activeWorkspaceKey = null
    }
  }
  if (retired.activeWorkspaceExecutionHostId === scope.hostId) {
    retired.activeWorkspaceExecutionHostId = null
  }
  if (retired.markdownFrontmatterVisible) {
    retired.markdownFrontmatterVisible = Object.fromEntries(
      Object.entries(retired.markdownFrontmatterVisible).filter(
        ([fileId]) => !removedMarkdownFileIds.has(fileId)
      )
    )
  }
  for (const repoId of scope.repoIds) {
    if (!scope.sharedRepoIds.has(repoId)) {
      delete retired.terminalTopologyRevisionByRepoId?.[repoId]
    }
  }
  return retired
}

function isVshudRuntimeHostFocus(session: WorkspaceSessionState): boolean {
  return parseExecutionHostId(session.activeWorkspaceExecutionHostId)?.kind === 'runtime'
}
