import type { VshudMigrationClientHostedBrowserCloseIntent } from '../../../../../shared/vshud-migration/vshud-migration-client-state'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import type { WorkspaceSessionState } from '../../../../../shared/workspace-session/workspace-session-state-types'
import {
  vshudMigrationOwnerMatchesScope,
  unqualifyVshudMigrationOwnerKey,
  type VshudMigrationSourceScope
} from '../catalog/vshud-source-scope'

export function collectCloseIntents(
  state: PersistedState,
  scope: VshudMigrationSourceScope,
  destinationEnvironmentId: string | undefined,
  eligibleSession: WorkspaceSessionState | undefined,
  onBlocked: () => void
): VshudMigrationClientHostedBrowserCloseIntent[] | undefined {
  const eligiblePages = new Set<string>()
  for (const [ownerKey, pages] of Object.entries(
    eligibleSession?.clientHostedBrowserPagesByWorktree ?? {}
  )) {
    if (!vshudMigrationOwnerMatchesScope(ownerKey, scope)) {
      continue
    }
    const worktreeId = unqualifyVshudMigrationOwnerKey(ownerKey)
    for (const page of pages) {
      eligiblePages.add(`${worktreeId}\0${page.browserPageId}`)
    }
  }
  const result: VshudMigrationClientHostedBrowserCloseIntent[] = []
  const seen = new Set<string>()
  const sessions = [
    state.workspaceSession,
    ...Object.values(state.workspaceSessionsByHostId ?? {}).flatMap((entry) =>
      entry ? [entry] : []
    )
  ].filter((entry): entry is WorkspaceSessionState => Boolean(entry))
  for (const session of sessions) {
    for (const [sourceEnvironmentId, intents] of Object.entries(
      session.clientHostedBrowserCloseIntentsByEnvironment ?? {}
    )) {
      if (sourceEnvironmentId === destinationEnvironmentId) {
        continue
      }
      for (const intent of intents) {
        if (!vshudMigrationOwnerMatchesScope(intent.worktreeId, scope)) {
          continue
        }
        const worktreeId = unqualifyVshudMigrationOwnerKey(intent.worktreeId)
        const key = `${sourceEnvironmentId}\0${intent.browserPageId}\0${worktreeId}`
        // The client still owes closes for pages that did not migrate.
        if (
          !eligiblePages.has(`${worktreeId}\0${intent.browserPageId}`) ||
          !destinationEnvironmentId
        ) {
          continue
        }
        if (seen.has(key)) {
          onBlocked()
          continue
        }
        seen.add(key)
        result.push({
          sourceEnvironmentId,
          browserPageId: intent.browserPageId,
          worktreeId,
          closedAt: intent.closedAt
        })
      }
    }
  }
  return result.length > 0 ? result : undefined
}
