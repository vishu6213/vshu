import type { VshudMigrationDormantStatePayload } from './vshud-migration-manifest'
import { getRepoIdFromWorktreeId } from '../worktree/id'
import { parseWorkspaceKey } from '../workspace/identity/workspace-scope'
import {
  assertVshudMigrationDormantWorkspaceSessionReferences,
  parseVshudMigrationDormantWorkspaceSession
} from './vshud-migration-dormant-session-validation'
import {
  assertVshudMigrationDormantAutomationReferences,
  parseVshudMigrationAutomationRunHistoryRef,
  parseVshudMigrationDormantAutomationRuns,
  parseVshudMigrationDormantAutomations
} from './vshud-migration-dormant-automation-validation'
import {
  assertVshudMigrationScrollbackReferences,
  parseVshudMigrationTerminalScrollbackSnapshots
} from './vshud-migration-scrollback'
import {
  assertVshudMigrationClientStateReferences,
  parseVshudMigrationClientState
} from './vshud-migration-client-state'
import {
  assertUnique,
  boundedArray,
  MAX_VSHUD_MIGRATION_DORMANT_NAMESPACES,
  requiredRecord
} from './vshud-migration-dormant-value-validation'
import {
  parseRetiredNames,
  parseRetirementNamespace,
  parseSparsePreset,
  parseWorkspaceLineageEntry,
  parseWorktreeLineageEntry,
  parseWorktreeMetaEntry
} from './vshud-migration-dormant-state-entry-validation'

export const VSHUD_MIGRATION_DORMANT_STATE_VERSION = 1 as const
export function parseVshudMigrationDormantState(value: unknown): VshudMigrationDormantStatePayload {
  const record = requiredRecord(value, 'vshud_migration_dormant_state_invalid')
  if (record.version !== VSHUD_MIGRATION_DORMANT_STATE_VERSION) {
    throw new Error('vshud_migration_dormant_state_version_unsupported')
  }
  const payload: VshudMigrationDormantStatePayload = {
    version: VSHUD_MIGRATION_DORMANT_STATE_VERSION,
    worktreeMeta: boundedArray(record.worktreeMeta, parseWorktreeMetaEntry, 'worktree_meta'),
    worktreeLineage: boundedArray(
      record.worktreeLineage,
      parseWorktreeLineageEntry,
      'worktree_lineage'
    ),
    workspaceLineage: boundedArray(
      record.workspaceLineage,
      parseWorkspaceLineageEntry,
      'workspace_lineage'
    ),
    sparsePresets: boundedArray(record.sparsePresets, parseSparsePreset, 'sparse_presets'),
    retiredWorktreeNames: boundedArray(
      record.retiredWorktreeNames,
      parseRetiredNames,
      'retired_names'
    ),
    retiredWorktreeNamespaces: boundedArray(
      record.retiredWorktreeNamespaces,
      parseRetirementNamespace,
      'retirement_namespaces',
      MAX_VSHUD_MIGRATION_DORMANT_NAMESPACES
    ),
    ...(record.workspaceSession === undefined
      ? {}
      : { workspaceSession: parseVshudMigrationDormantWorkspaceSession(record.workspaceSession) }),
    ...(record.terminalScrollbackSnapshots === undefined
      ? {}
      : {
          terminalScrollbackSnapshots: parseVshudMigrationTerminalScrollbackSnapshots(
            record.terminalScrollbackSnapshots
          )
        }),
    ...(record.automations === undefined
      ? {}
      : { automations: parseVshudMigrationDormantAutomations(record.automations) }),
    ...(record.automationRuns === undefined
      ? {}
      : { automationRuns: parseVshudMigrationDormantAutomationRuns(record.automationRuns) }),
    ...(record.automationRunHistory === undefined
      ? {}
      : {
          automationRunHistory: parseVshudMigrationAutomationRunHistoryRef(
            record.automationRunHistory
          )
        }),
    ...(record.clientState === undefined
      ? {}
      : { clientState: parseVshudMigrationClientState(record.clientState) })
  }
  if (payload.automationRuns && payload.automationRunHistory) {
    throw new Error('vshud_migration_dormant_automation_run_history_conflict')
  }
  assertUnique(payload.worktreeMeta, (entry) => entry.worktreeId, 'worktree_meta')
  assertUnique(payload.worktreeMeta, (entry) => entry.sourceKey, 'worktree_meta_source')
  assertUnique(payload.worktreeLineage, (entry) => entry.worktreeId, 'worktree_lineage')
  assertUnique(payload.worktreeLineage, (entry) => entry.sourceKey, 'worktree_lineage_source')
  assertUnique(payload.workspaceLineage, (entry) => entry.childWorkspaceKey, 'workspace_lineage')
  assertUnique(payload.workspaceLineage, (entry) => entry.sourceKey, 'workspace_lineage_source')
  assertUnique(payload.sparsePresets, (entry) => `${entry.repoId}\0${entry.id}`, 'sparse_preset')
  assertUnique(payload.retiredWorktreeNames, (entry) => entry.repoId, 'retired_names')
  assertUnique(
    payload.retiredWorktreeNamespaces,
    (entry) => entry.namespaceKey,
    'retirement_namespace'
  )
  return payload
}

export function assertVshudMigrationDormantStateReferences(args: {
  dormantState: VshudMigrationDormantStatePayload
  repositoryIds: ReadonlySet<string>
  folderWorkspaceIds: ReadonlySet<string>
}): void {
  const owns = (value: string): boolean => {
    const parsed = parseWorkspaceKey(value)
    if (parsed?.type === 'folder') {
      return args.folderWorkspaceIds.has(parsed.folderWorkspaceId)
    }
    const worktreeId = parsed?.type === 'worktree' ? parsed.worktreeId : value
    return args.repositoryIds.has(getRepoIdFromWorktreeId(worktreeId))
  }
  for (const entry of args.dormantState.worktreeMeta) {
    if (!owns(entry.worktreeId) || entry.meta.hostId !== 'local') {
      throw new Error('vshud_migration_dormant_worktree_meta_scope_invalid')
    }
  }
  for (const entry of args.dormantState.worktreeLineage) {
    if (
      entry.worktreeId !== entry.lineage.worktreeId ||
      !owns(entry.worktreeId) ||
      !owns(entry.lineage.parentWorktreeId)
    ) {
      throw new Error('vshud_migration_dormant_worktree_lineage_scope_invalid')
    }
  }
  for (const entry of args.dormantState.workspaceLineage) {
    if (
      entry.childWorkspaceKey !== entry.lineage.childWorkspaceKey ||
      !owns(entry.childWorkspaceKey) ||
      !owns(entry.lineage.parentWorkspaceKey)
    ) {
      throw new Error('vshud_migration_dormant_workspace_lineage_scope_invalid')
    }
  }
  for (const preset of args.dormantState.sparsePresets) {
    if (!args.repositoryIds.has(preset.repoId)) {
      throw new Error('vshud_migration_dormant_sparse_preset_scope_invalid')
    }
  }
  for (const entry of args.dormantState.retiredWorktreeNames) {
    if (!args.repositoryIds.has(entry.repoId)) {
      throw new Error('vshud_migration_dormant_retired_names_scope_invalid')
    }
  }
  for (const entry of args.dormantState.retiredWorktreeNamespaces) {
    if (
      !entry.namespaceKey.startsWith('local:') ||
      entry.sourceNamespaceKeys.some((key) => !key.startsWith('ssh:'))
    ) {
      throw new Error('vshud_migration_dormant_retirement_namespace_scope_invalid')
    }
  }
  if (args.dormantState.workspaceSession) {
    assertVshudMigrationDormantWorkspaceSessionReferences({
      session: args.dormantState.workspaceSession,
      owns,
      repositoryIds: args.repositoryIds
    })
  }
  assertVshudMigrationScrollbackReferences(
    args.dormantState.workspaceSession,
    args.dormantState.terminalScrollbackSnapshots ?? []
  )
  assertVshudMigrationDormantAutomationReferences({
    automations: args.dormantState.automations ?? [],
    automationRuns: args.dormantState.automationRuns ?? [],
    owns,
    repositoryIds: args.repositoryIds
  })
  assertVshudMigrationClientStateReferences({
    clientState: args.dormantState.clientState,
    repositoryIds: args.repositoryIds,
    owns
  })
}
