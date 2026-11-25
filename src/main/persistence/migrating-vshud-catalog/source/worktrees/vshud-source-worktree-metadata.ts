import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import type { WorktreeMeta } from '../../../../../shared/worktree/meta-types'

import {
  type VshudMigrationManifest,
  serializeVshudMigrationValue
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import { canonicalWorktreeIdentity } from '../../../../../shared/worktree/identity'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  isWorktreeHostIdentity
} from '../../../../../shared/worktree/host-qualified-identity'
import { pruneUnreferencedWorktreeIdentityMeta } from '../../../loading-store/worktree-metadata/worktree-identity-metadata'
import {
  createVshudMigrationSourceScope,
  vshudMigrationOwnerMatchesScope,
  vshudMigrationScopeOwnsWholeHost,
  unqualifyVshudMigrationOwnerKey,
  type VshudMigrationSourceScope
} from '../catalog/vshud-source-scope'

export function inspectVshudSourceWorktreeMetadata(
  state: PersistedState,
  scope: VshudMigrationSourceScope
) {
  const rows: { sourceKey: string; meta: WorktreeMeta }[] = []
  let blockedCount = 0
  const wholeHost = vshudMigrationScopeOwnsWholeHost(scope)
  for (const [sourceKey, meta] of Object.entries(state.worktreeMeta)) {
    const host = getExecutionHostIdFromWorktreeHostIdentity(sourceKey)
    if ((host && host !== scope.hostId) || (meta.hostId && meta.hostId !== scope.hostId)) {
      if (
        (host === scope.hostId || meta.hostId === scope.hostId) &&
        (wholeHost || vshudMigrationOwnerMatchesScope(sourceKey, scope))
      ) {
        blockedCount++
      }
      continue
    }
    if (vshudMigrationOwnerMatchesScope(sourceKey, scope, meta.hostId)) {
      rows.push({ sourceKey, meta })
    } else if (wholeHost && (meta.hostId === scope.hostId || host === scope.hostId)) {
      blockedCount++
    }
  }
  const referenced = new Set(Object.values(state.worktreeIdentityAliases ?? {}).flat())
  for (const [identity, meta] of Object.entries(state.worktreeMetaByIdentity ?? {})) {
    // An unreferenced identity names no worktree, so only a whole-host move can claim it.
    if (wholeHost && meta.hostId === scope.hostId && !referenced.has(identity)) {
      blockedCount++
    }
  }
  for (const [alias, identities] of Object.entries(state.worktreeIdentityAliases ?? {})) {
    if (getExecutionHostIdFromWorktreeHostIdentity(alias) !== scope.hostId) {
      continue
    }
    if (!wholeHost && !vshudMigrationOwnerMatchesScope(alias, scope)) {
      continue
    }
    if (isDanglingAlias(state, identities) && vshudMigrationOwnerMatchesScope(alias, scope)) {
      continue // Dangling aliases carry no metadata; any legacy row migrates separately.
    }
    const meta = identities.length === 1 ? state.worktreeMetaByIdentity?.[identities[0]] : undefined
    const worktreeId = unqualifyVshudMigrationOwnerKey(alias)
    if (
      isWorktreeHostIdentity(worktreeId) ||
      !vshudMigrationOwnerMatchesScope(alias, scope) ||
      !meta ||
      !meta.instanceId ||
      (meta.hostId !== undefined && meta.hostId !== scope.hostId) ||
      identities[0] !==
        canonicalWorktreeIdentity({
          worktreeId,
          executionHostId: scope.hostId,
          instanceId: meta.instanceId
        })
    ) {
      blockedCount++
      continue
    }
    const legacy = rows.filter(
      (row) => unqualifyVshudMigrationOwnerKey(row.sourceKey) === worktreeId
    )
    if (
      legacy.length > 1 ||
      (legacy.length === 1 &&
        serializeVshudMigrationValue({ ...legacy[0].meta, hostId: scope.hostId }) !==
          serializeVshudMigrationValue({ ...meta, hostId: scope.hostId }))
    ) {
      // Neither representation may silently discard data held only by its competing row.
      blockedCount++
      continue
    }
    if (legacy.length === 0) {
      rows.push({ sourceKey: alias, meta: { ...meta, hostId: scope.hostId } })
    }
  }
  return { rows, blockedCount }
}

export function subtractVshudSourceWorktreeMetadata(
  state: PersistedState,
  manifest: VshudMigrationManifest
) {
  const scope = createVshudMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const entries = manifest.payload.dormantState?.worktreeMeta ?? []
  // The server owns moved projects, including rows added later by downgraded builds.
  const added = inspectVshudSourceWorktreeMetadata(state, scope).rows.map((row) => row.sourceKey)
  const sourceKeys = new Set([...entries.map((entry) => entry.sourceKey), ...added])
  const worktreeIds = new Set([
    ...entries.map((entry) => entry.worktreeId),
    ...added.map(unqualifyVshudMigrationOwnerKey)
  ])
  const removedIdentities = new Set<string>()
  for (const [alias, identities] of Object.entries(state.worktreeIdentityAliases ?? {})) {
    if (
      getExecutionHostIdFromWorktreeHostIdentity(alias) === scope.hostId &&
      (worktreeIds.has(unqualifyVshudMigrationOwnerKey(alias)) ||
        (isDanglingAlias(state, identities) && vshudMigrationOwnerMatchesScope(alias, scope)))
    ) {
      identities.forEach((identity) => removedIdentities.add(identity))
      delete state.worktreeIdentityAliases?.[alias]
    }
  }
  sourceKeys.forEach((sourceKey) => delete state.worktreeMeta[sourceKey])
  pruneUnreferencedWorktreeIdentityMeta(state, removedIdentities)
}

function isDanglingAlias(state: PersistedState, identities: readonly string[]): boolean {
  return identities.every((identity) => {
    const meta = state.worktreeMetaByIdentity?.[identity]
    return !meta || Object.keys(meta).length === 0
  })
}
