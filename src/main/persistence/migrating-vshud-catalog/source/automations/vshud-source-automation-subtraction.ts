import { getAutomationRunRepoId } from '../../../../../shared/automations/history/automation-run-identity'
import type { VshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import {
  createVshudMigrationSourceScope,
  vshudMigrationOwnsRepoId
} from '../catalog/vshud-source-scope'

/** Include rows a downgraded build added to moved projects. */
export function subtractVshudMigrationSourceAutomationState(
  state: PersistedState,
  manifest: VshudMigrationManifest
): void {
  const scope = createVshudMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const automationIds = new Set([
    ...(manifest.payload.dormantState?.automations ?? []).map((entry) => entry.id),
    ...state.automations
      .filter(
        (entry) =>
          vshudMigrationOwnsRepoId(scope, getAutomationRunRepoId(entry)) &&
          (entry.executionTargetType !== 'ssh' || entry.executionTargetId === scope.targetId)
      )
      .map((entry) => entry.id)
  ])
  const runIds = new Set((manifest.payload.dormantState?.automationRuns ?? []).map((run) => run.id))
  state.automations = state.automations.filter((entry) => !automationIds.has(entry.id))
  state.automationRuns = state.automationRuns.filter(
    (run) => !runIds.has(run.id) && !automationIds.has(run.automationId)
  )
}
