// Export only additions from older builds by subtracting prior migrations from a profile copy.
import type {
  VshudMigrationCatalogPayload,
  VshudMigrationDormantStatePayload,
  VshudMigrationManifest,
  VshudMigrationManifestSource
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import type { FolderWorkspace } from '../../../../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../../../../shared/project/groups/project-group-types'
import type { Repo } from '../../../../../shared/repository/repo-types'
import type { StoreRuntimeState } from '../../../loading-store/store-runtime-state'
import { subtractVshudSourceCatalogState } from './vshud-source-catalog-subtraction'
import {
  collectVshudMigrationUntransferredDependencyCensus,
  type VshudMigrationSourceDependencyCensus
} from '../sessions/vshud-source-dependency-census'
import { subtractVshudMigrationSourceDormantState } from '../dormancy/vshud-source-dormant-subtraction'
import { collectVshudMigrationSourceDormantState } from '../dormancy/vshud-source-dormant-state'
import { subtractVshudMigrationScopeWorkspaceSession } from '../sessions/vshud-source-workspace-session-subtraction'

export type VshudMigrationDeltaView = {
  getRepos: () => Repo[]
  getFolderWorkspaces: () => FolderWorkspace[]
  getProjectGroups: () => ProjectGroup[]
  collectVshudMigrationSourceDormantState: (
    source: VshudMigrationManifestSource,
    catalog: VshudMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ) => VshudMigrationDormantStatePayload
  inspectVshudMigrationUntransferredDependencies: (
    manifest: VshudMigrationManifest
  ) => VshudMigrationSourceDependencyCensus
}

/** moved includes today's edits to previously migrated rows. */
export function createVshudMigrationDeltaView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  moved: VshudMigrationManifest
): VshudMigrationDeltaView {
  const state = structuredClone(runtime.state)
  subtractVshudSourceCatalogState(state, moved)
  subtractVshudMigrationSourceDormantState(state, moved)
  // The server owns the moved projects' tabs now, even ones the older build left unmovable.
  subtractVshudMigrationScopeWorkspaceSession(state, moved)
  const storage = runtime.terminalScrollbackSnapshotStorage
  return {
    getRepos: () => state.repos,
    getFolderWorkspaces: () => state.folderWorkspaces,
    getProjectGroups: () => state.projectGroups,
    collectVshudMigrationSourceDormantState: (source, catalog, destinationEnvironmentId) =>
      collectVshudMigrationSourceDormantState(
        state,
        source,
        catalog,
        storage,
        destinationEnvironmentId
      ).payload,
    inspectVshudMigrationUntransferredDependencies: (manifest) =>
      collectVshudMigrationUntransferredDependencyCensus(state, manifest, storage)
  }
}
