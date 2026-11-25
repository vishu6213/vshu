import type {
  VshudMigrationDormantStatePayload,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { PersistedState } from '../../../../shared/vshu-profiles/persisted-state-types'
import type { SparsePreset } from '../../../../shared/worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import { omitDefaultWorktreeMetaFields } from '../../../../shared/worktree/metadata/meta-persisted-defaults'
import { assertVshudDestinationCanonicalMetadata } from './vshud-destination-worktree-metadata'
import { assertSameValue } from '../catalog-commit/vshud-catalog-row-identity'
import {
  mergeRetiredNameRegistries,
  type RetiredNameRegistry
} from '../../../../shared/worktree/naming/retired-name-registry'
import { recordRetirementNamespaceRegistry } from '../../../workspaces/removal/retirement/worktree-retirement-namespace'
import {
  applyPreparedVshudMigrationWorkspaceSession,
  prepareVshudMigrationWorkspaceSession,
  type PreparedVshudMigrationWorkspaceSession
} from './vshud-destination-workspace-session'
import {
  applyPreparedVshudMigrationAutomationState,
  prepareVshudMigrationAutomationState,
  type PreparedVshudMigrationAutomationState
} from './vshud-destination-automation-state'
import {
  applyPreparedVshudMigrationClientState,
  prepareVshudMigrationClientState,
  type PreparedVshudMigrationClientState
} from './vshud-destination-client-state'
import {
  applyImportedLineage,
  reconcileImportedLineage,
  type PreparedChildLineage
} from './vshud-dormant-lineage-reconciliation'

type KeyedRow<T> = { key: string; value: T }
type RegistryUpdate = { key: string; value: RetiredNameRegistry }

export type PreparedVshudMigrationDormantState = {
  payload: VshudMigrationDormantStatePayload | undefined
  newWorktreeMeta: KeyedRow<WorktreeMeta>[]
  lineage: PreparedChildLineage[]
  newSparsePresets: SparsePreset[]
  retiredNameUpdates: RegistryUpdate[]
  retirementNamespaceUpdates: RegistryUpdate[]
  workspaceSession: PreparedVshudMigrationWorkspaceSession
  automationState: PreparedVshudMigrationAutomationState
  clientState: PreparedVshudMigrationClientState
}

export function prepareVshudMigrationDormantState(
  manifest: VshudMigrationManifest,
  state: PersistedState
): PreparedVshudMigrationDormantState {
  const payload = manifest.payload.dormantState
  if (!payload) {
    return emptyPreparedDormantState()
  }
  assertVshudDestinationCanonicalMetadata(state, payload.worktreeMeta)
  const worktreeMeta = payload.worktreeMeta.map((entry) => ({
    key: entry.worktreeId,
    value: structuredClone(entry.meta)
  }))
  const worktreeLineage = payload.worktreeLineage.map((entry) => ({
    key: entry.worktreeId,
    value: structuredClone(entry.lineage)
  }))
  const workspaceLineage = payload.workspaceLineage.map((entry) => ({
    key: entry.childWorkspaceKey,
    value: structuredClone(entry.lineage)
  }))
  const existingPresets = new Map(
    Object.values(state.sparsePresetsByRepo)
      .flat()
      .map((preset) => [sparsePresetKey(preset), preset])
  )
  const newSparsePresets = payload.sparsePresets.filter((preset) => {
    const existing = existingPresets.get(sparsePresetKey(preset))
    if (!existing) {
      return true
    }
    assertSameValue(existing, preset, `sparse_preset:${preset.repoId}:${preset.id}`)
    return false
  })
  return {
    payload,
    newWorktreeMeta: selectNewKeyedRows(
      worktreeMeta,
      state.worktreeMeta,
      'worktree_meta',
      omitDefaultWorktreeMetaFields
    ),
    lineage: prepareImportedLineage(state, worktreeLineage, workspaceLineage),
    newSparsePresets,
    retiredNameUpdates: payload.retiredWorktreeNames.map((entry) => ({
      key: entry.repoId,
      value: mergeRetiredNameRegistries(
        state.retiredWorktreeNamesByRepo?.[entry.repoId] ?? { exhaustedTiers: 0, names: [] },
        entry.registry
      )
    })),
    retirementNamespaceUpdates: payload.retiredWorktreeNamespaces.map((entry) => ({
      key: entry.namespaceKey,
      value: mergeRetiredNameRegistries(
        state.retiredWorktreeNamesByNamespace?.[entry.namespaceKey] ?? {
          exhaustedTiers: 0,
          names: []
        },
        entry.registry
      )
    })),
    workspaceSession: prepareVshudMigrationWorkspaceSession(payload.workspaceSession, state),
    automationState: prepareVshudMigrationAutomationState(
      payload.automations,
      payload.automationRuns,
      state
    ),
    clientState: prepareVshudMigrationClientState(payload.clientState, state)
  }
}

export function applyPreparedVshudMigrationDormantState(
  prepared: PreparedVshudMigrationDormantState,
  state: PersistedState
): void {
  for (const entry of prepared.newWorktreeMeta) {
    state.worktreeMeta[entry.key] = entry.value
  }
  applyImportedLineage(prepared.lineage, state)
  for (const preset of prepared.newSparsePresets) {
    state.sparsePresetsByRepo[preset.repoId] = [
      ...(state.sparsePresetsByRepo[preset.repoId] ?? []),
      preset
    ]
  }
  if (prepared.retiredNameUpdates.length > 0) {
    state.retiredWorktreeNamesByRepo ??= {}
    for (const entry of prepared.retiredNameUpdates) {
      state.retiredWorktreeNamesByRepo[entry.key] = entry.value
    }
  }
  if (prepared.retirementNamespaceUpdates.length > 0) {
    state.retiredWorktreeNamesByNamespace ??= {}
    for (const entry of prepared.retirementNamespaceUpdates) {
      recordRetirementNamespaceRegistry(
        state.retiredWorktreeNamesByNamespace,
        entry.key,
        entry.value
      )
    }
  }
  applyPreparedVshudMigrationWorkspaceSession(prepared.workspaceSession, state)
  applyPreparedVshudMigrationAutomationState(prepared.automationState, state)
  applyPreparedVshudMigrationClientState(prepared.clientState, state)
}

/** Same-key mismatches refuse first, as for every dormant row; then each child gets one parent. */
function prepareImportedLineage(
  state: PersistedState,
  worktreeLineage: KeyedRow<WorktreeLineage>[],
  workspaceLineage: KeyedRow<WorkspaceLineage>[]
): PreparedChildLineage[] {
  selectNewKeyedRows(worktreeLineage, state.worktreeLineageById, 'worktree_lineage')
  selectNewKeyedRows(workspaceLineage, state.workspaceLineageByChildKey, 'workspace_lineage')
  return reconcileImportedLineage(state, { worktreeLineage, workspaceLineage })
}

function selectNewKeyedRows<T>(
  incoming: KeyedRow<T>[],
  existing: Record<string, T>,
  label: string,
  canonicalize: (value: T) => T = (value) => value
): KeyedRow<T>[] {
  return incoming.filter((entry) => {
    const current = existing[entry.key]
    if (current === undefined) {
      return true
    }
    assertSameValue(canonicalize(current), canonicalize(entry.value), `${label}:${entry.key}`)
    return false
  })
}

const sparsePresetKey = (preset: Pick<SparsePreset, 'id' | 'repoId'>): string =>
  `${preset.repoId}\0${preset.id}`

function emptyPreparedDormantState(): PreparedVshudMigrationDormantState {
  return {
    payload: undefined,
    newWorktreeMeta: [],
    lineage: [],
    newSparsePresets: [],
    retiredNameUpdates: [],
    retirementNamespaceUpdates: [],
    workspaceSession: { incoming: undefined, merged: undefined },
    automationState: {
      incomingAutomations: [],
      incomingRuns: [],
      newAutomations: [],
      newRuns: []
    },
    clientState: {
      incoming: undefined,
      mobileSelections: {},
      uiRouting: undefined
    }
  }
}
