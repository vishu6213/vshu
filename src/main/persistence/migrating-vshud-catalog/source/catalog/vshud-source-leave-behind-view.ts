// Offer "Move anyway" only when a consent-free preview shows it clears the blockers.
import type { StoreRuntimeState } from '../../../loading-store/store-runtime-state'
import { collectVshudMigrationUntransferredDependencyCensus } from '../sessions/vshud-source-dependency-census'
import { collectVshudMigrationSourceDormantState } from '../dormancy/vshud-source-dormant-state'
import type { VshudMigrationDeltaView } from './vshud-source-delta-view'

export function createVshudMigrationLeaveBehindView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  targetId: string
): VshudMigrationDeltaView {
  // Read-only collectors make a shallow copy sufficient.
  const state = {
    ...runtime.state,
    sshTargets: runtime.state.sshTargets.map((target) =>
      target.id === targetId
        ? { ...target, managedServerLeaveBehind: { confirmedAt: new Date(0).toISOString() } }
        : target
    )
  }
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
