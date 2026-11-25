import type { VshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import { subtractVshudSourceWorktreeMetadata } from '../worktrees/vshud-source-worktree-metadata'
import { subtractVshudMigrationSourceAutomationState } from '../automations/vshud-source-automation-subtraction'
import { subtractVshudMigrationSourceWorkspaceSession } from '../sessions/vshud-source-workspace-session-subtraction'
import { subtractVshudMigrationClientState } from '../clients/vshud-source-client-subtraction'

/** Mutate a delta-view copy only. */
export function subtractVshudMigrationSourceDormantState(
  state: PersistedState,
  manifest: VshudMigrationManifest
): void {
  // Include state a downgraded build added even when the manifest had none.
  subtractVshudSourceWorktreeMetadata(state, manifest)
  subtractVshudMigrationSourceAutomationState(state, manifest)
  const dormant = manifest.payload.dormantState
  if (!dormant) {
    return
  }
  dormant.worktreeLineage.forEach((entry) => delete state.worktreeLineageById[entry.sourceKey])
  dormant.workspaceLineage.forEach(
    (entry) => delete state.workspaceLineageByChildKey[entry.sourceKey]
  )
  for (const preset of dormant.sparsePresets) {
    const remaining = (state.sparsePresetsByRepo[preset.repoId] ?? []).filter(
      (entry) => entry.id !== preset.id
    )
    if (remaining.length > 0) {
      state.sparsePresetsByRepo[preset.repoId] = remaining
    } else {
      delete state.sparsePresetsByRepo[preset.repoId]
    }
  }
  for (const entry of dormant.retiredWorktreeNames) {
    delete state.retiredWorktreeNamesByRepo?.[entry.repoId]
  }
  subtractVshudMigrationSourceWorkspaceSession(state, manifest)
  subtractVshudMigrationClientState(state, manifest)
  // Retain snapshot files: the prior durable profile and rollback evidence can still reference them.
}
