import { automationCanonicalDefinition } from '../../../../../shared/automations/launch/automation-launch-setup'
import {
  isFinalAutomationRunStatus,
  type AutomationRun
} from '../../../../../shared/automations/history/automation-run'
import type { Automation } from '../../../../../shared/automations/automation-definition'
import { getAutomationRunRepoId } from '../../../../../shared/automations/history/automation-run-identity'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host/execution-host'
import type {
  VshudMigrationCatalogPayload,
  VshudMigrationManifestSource
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import type {
  TaskSourceContext,
  WorkspaceRunContext
} from '../../../../../shared/work-items/task-source-context'
import {
  createVshudMigrationExportScope,
  vshudMigrationScopeOwnsWholeHost,
  vshudMigrationOwnerMatchesScope,
  vshudMigrationOwnsRepoId,
  type VshudMigrationSourceScope,
  unqualifyVshudMigrationOwnerKey
} from '../catalog/vshud-source-scope'
import { compareKeys } from '../catalog/vshud-source-key-order'

export type VshudMigrationSourceAutomationInspection = {
  automations: Automation[]
  automationRuns: AutomationRun[]
  blockedAutomationCount: number
  blockedRunCount: number
  /** Moved disabled, as the wire requires; the move re-enables these on the host after commit. */
  enabledAtSourceIds: string[]
  /** Automations held back only by a run still in flight; they move once it finishes. */
  runningAutomationNames: string[]
}

export function collectVshudMigrationSourceAutomationState(
  state: PersistedState,
  source: VshudMigrationManifestSource,
  catalog: VshudMigrationCatalogPayload
): VshudMigrationSourceAutomationInspection {
  const scope = createVshudMigrationExportScope({ source, catalog, repos: state.repos })
  const touchedAutomations = state.automations.filter((entry) =>
    automationTouchesScope(entry, scope)
  )
  const touchedAutomationIds = new Set(touchedAutomations.map((entry) => entry.id))
  const touchedRuns = state.automationRuns.filter(
    (entry) => touchedAutomationIds.has(entry.automationId) || runTouchesScope(entry, scope)
  )
  const runsByAutomationId = Map.groupBy(touchedRuns, (entry) => entry.automationId)
  const automationsById = Map.groupBy(touchedAutomations, (entry) => entry.id)
  const automations: Automation[] = []
  const automationRuns: AutomationRun[] = []
  let blockedAutomationCount = 0
  let blockedRunCount = 0
  const enabledAtSourceIds: string[] = []
  const runningAutomationNames: string[] = []

  for (const [automationId, matching] of automationsById) {
    const runs = runsByAutomationId.get(automationId) ?? []
    const transferable =
      matching.length === 1 &&
      automationCanTransfer(matching[0], scope) &&
      runs.every((run) => runContextCanTransfer(run, scope))
    if (!transferable || !runs.every((run) => isFinalAutomationRunStatus(run.status))) {
      if (transferable) {
        runningAutomationNames.push(matching[0].name)
      }
      blockedAutomationCount += matching.length
      blockedRunCount += runs.length
      continue
    }
    const projected = projectAutomationToDestination(matching[0])
    // The projection always sends it disabled; a WSL move re-enables what ran here.
    if (scope.kind === 'local-wsl' && matching[0].enabled) {
      enabledAtSourceIds.push(projected.id)
    }
    automations.push(projected)
    automationRuns.push(...runs.map(projectAutomationRunToDestination))
  }

  for (const [automationId, runs] of runsByAutomationId) {
    if (!automationsById.has(automationId)) {
      blockedRunCount += runs.length
    }
  }
  automations.sort((left, right) => compareKeys(left.id, right.id))
  automationRuns.sort((left, right) => compareKeys(left.id, right.id))
  enabledAtSourceIds.sort(compareKeys)
  return {
    automations,
    automationRuns,
    blockedAutomationCount,
    blockedRunCount,
    enabledAtSourceIds,
    runningAutomationNames: runningAutomationNames.sort(compareKeys)
  }
}

export function automationTouchesScope(
  automation: Automation,
  scope: VshudMigrationSourceScope
): boolean {
  return (
    (automation.executionTargetType === 'ssh' && automation.executionTargetId === scope.targetId) ||
    // Generations are target-local; another host can share the same number.
    (scope.targetGeneration !== null &&
      automation.executionTargetId === scope.targetId &&
      automation.executionTargetGeneration === scope.targetGeneration) ||
    vshudMigrationOwnsRepoId(scope, getAutomationRunRepoId(automation)) ||
    vshudMigrationOwnerMatchesScope(automation.workspaceId, scope) ||
    contextTouchesScope(automation.runContext, scope) ||
    contextTouchesScope(automation.sourceContext, scope)
  )
}

function runTouchesScope(run: AutomationRun, scope: VshudMigrationSourceScope): boolean {
  return (
    vshudMigrationOwnerMatchesScope(run.workspaceId, scope) ||
    contextTouchesScope(run.runContext, scope) ||
    contextTouchesScope(run.sourceContext, scope)
  )
}

function automationCanTransfer(automation: Automation, scope: VshudMigrationSourceScope): boolean {
  if (scope.kind === 'local-wsl') {
    // This desktop schedules it today; the host's scheduler takes over, re-enabled after commit.
    return (
      automation.executionTargetType === 'local' &&
      automation.schedulerOwner === 'local_host_service' &&
      scope.repoIds.has(getAutomationRunRepoId(automation)) &&
      ownerCanTransfer(automation.workspaceId, scope) &&
      contextCanTransfer(automation.runContext, scope) &&
      contextCanTransfer(automation.sourceContext, scope)
    )
  }
  return (
    automation.executionTargetType === 'ssh' &&
    automation.executionTargetId === scope.targetId &&
    automation.schedulerOwner === 'ssh_bridge' &&
    (automation.executionTargetGeneration === undefined ||
      automation.executionTargetGeneration === scope.targetGeneration) &&
    scope.repoIds.has(getAutomationRunRepoId(automation)) &&
    ownerCanTransfer(automation.workspaceId, scope) &&
    contextCanTransfer(automation.runContext, scope) &&
    contextCanTransfer(automation.sourceContext, scope)
  )
}

function runContextCanTransfer(run: AutomationRun, scope: VshudMigrationSourceScope): boolean {
  return (
    ownerCanTransfer(run.workspaceId, scope) &&
    contextCanTransfer(run.runContext, scope) &&
    contextCanTransfer(run.sourceContext, scope)
  )
}

function ownerCanTransfer(value: string | null, scope: VshudMigrationSourceScope): boolean {
  return value === null || vshudMigrationOwnerMatchesScope(value, scope)
}

function contextTouchesScope(
  context: WorkspaceRunContext | TaskSourceContext | null | undefined,
  scope: VshudMigrationSourceScope
): boolean {
  if (!vshudMigrationScopeOwnsWholeHost(scope)) {
    return (
      (!context?.hostId || context.hostId === scope.hostId) &&
      vshudMigrationOwnsRepoId(scope, context?.repoId)
    )
  }
  return (
    context?.hostId === scope.hostId ||
    (!context?.hostId && vshudMigrationOwnsRepoId(scope, context?.repoId))
  )
}

function contextCanTransfer(
  context: WorkspaceRunContext | TaskSourceContext | null | undefined,
  scope: VshudMigrationSourceScope
): boolean {
  if (!context) {
    return true
  }
  return (
    context.hostId === scope.hostId &&
    typeof context.repoId === 'string' &&
    scope.repoIds.has(context.repoId) &&
    (!context.projectHostSetupId || context.projectHostSetupId === context.repoId)
  )
}

function projectAutomationToDestination(source: Automation): Automation {
  const destination: Automation = {
    ...structuredClone(automationCanonicalDefinition(source)),
    runContext: projectContextToDestination(source.runContext),
    sourceContext: projectContextToDestination(source.sourceContext),
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'remote_host_service',
    // Servers accept only dormant rows; the desktop re-enables moved ones after commit.
    enabled: false,
    workspaceId: projectOwnerToDestination(source.workspaceId)
  }
  delete destination.executionTargetGeneration
  return destination
}

function projectAutomationRunToDestination(source: AutomationRun): AutomationRun {
  return {
    ...structuredClone(source),
    runContext: projectContextToDestination(source.runContext),
    sourceContext: projectContextToDestination(source.sourceContext),
    workspaceId: projectOwnerToDestination(source.workspaceId)
  }
}

function projectContextToDestination<T extends WorkspaceRunContext | TaskSourceContext>(
  context: T | null | undefined
): T | null {
  if (!context) {
    return null
  }
  return Object.assign(structuredClone(context), {
    hostId: LOCAL_EXECUTION_HOST_ID,
    projectHostSetupId: context.repoId ?? null
  })
}

function projectOwnerToDestination(value: string | null): string | null {
  return value === null ? null : unqualifyVshudMigrationOwnerKey(value)
}
