import type { VshudMigrationCatalogPayload } from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import { withoutVshudRetainedMarker } from '../../../../../shared/remote-runtime/vshud-lifecycle/vshud-retained-marker'
import type { ProjectGroup } from '../../../../../shared/project/groups/project-group-types'
import type { SshTarget } from '../../../../../shared/remote-runtime/ssh/ssh-types'
import type { Store } from '../../../loading-store/store'
import { vshudSourceFolderWorkspaceIds, repoBelongsToVshudSource } from './vshud-source-ownership'

type VshudSourceCatalogStore = Pick<Store, 'getFolderWorkspaces' | 'getProjectGroups' | 'getRepos'>

export function collectVshudMigrationSourceCatalog(
  store: VshudSourceCatalogStore,
  target: Pick<SshTarget, 'id'>
): VshudMigrationCatalogPayload {
  const allRepos = store.getRepos()
  const allGroups = store.getProjectGroups()
  const allFolders = store.getFolderWorkspaces()
  const repositories = allRepos
    .filter((repo) => repoBelongsToVshudSource(repo, target.id))
    .map(withoutVshudRetainedMarker)
  const ownedFolderIds = vshudSourceFolderWorkspaceIds(
    { repos: allRepos, projectGroups: allGroups, folderWorkspaces: allFolders },
    target.id
  )
  const folderWorkspaces = allFolders
    .filter((workspace) => ownedFolderIds.has(workspace.id))
    .map(withoutVshudRetainedMarker)
  const projectGroups = collectProjectGroups(
    allGroups,
    new Set([
      ...repositories.flatMap((repo) => (repo.projectGroupId ? [repo.projectGroupId] : [])),
      ...folderWorkspaces.map((workspace) => workspace.projectGroupId),
      ...allGroups.filter((group) => group.connectionId === target.id).map((group) => group.id)
    ])
  )
  return { repositories, projectGroups, folderWorkspaces }
}

export function collectProjectGroups(
  groups: ProjectGroup[],
  initialIds: ReadonlySet<string>
): ProjectGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const includedIds = new Set(initialIds)
  const pending = [...initialIds]
  while (pending.length > 0) {
    const nextId = pending.pop()
    if (!nextId) {
      continue
    }
    const group = byId.get(nextId)
    if (!group?.parentGroupId || includedIds.has(group.parentGroupId)) {
      continue
    }
    includedIds.add(group.parentGroupId)
    pending.push(group.parentGroupId)
  }
  return groups.filter((group) => includedIds.has(group.id)).map((group) => structuredClone(group))
}
