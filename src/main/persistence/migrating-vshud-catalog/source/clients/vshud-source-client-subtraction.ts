import {
  type VshudMigrationManifest,
  serializeVshudMigrationValue
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import { requireVshudMigrationSshSource } from '../../../../../shared/vshud-migration/vshud-migration-source-kind'
import { parsePersistedAutomationHostFilter } from '../../../../../shared/automations/ownership/automation-host-filter'
import { hostStableKey } from '../../../../../shared/automations/ownership/automation-owner-key'
import { toRuntimeExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import { composeWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import type { VshudMigrationClientStatePayload } from '../../../../../shared/vshud-migration/vshud-migration-client-state'
import type { PersistedState } from '../../../../../shared/vshu-profiles/persisted-state-types'
import {
  MAX_CLIENT_HOSTED_BROWSER_CLOSE_INTENTS,
  type ClientHostedBrowserCloseIntent
} from '../../../../../shared/workspace-session/client-hosted-browser-close-intent'
import {
  createVshudMigrationSourceScope,
  vshudMigrationOwnerMatchesScope,
  unqualifyVshudMigrationOwnerKey
} from '../catalog/vshud-source-scope'

/** Mutate a delta-view copy only. */
export function subtractVshudMigrationClientState(
  state: PersistedState,
  manifest: VshudMigrationManifest
): void {
  const clientState = manifest.payload.dormantState?.clientState
  if (!clientState) {
    return
  }
  const source = manifest.source
  const scope = createVshudMigrationSourceScope({
    source,
    catalog: manifest.payload,
    repos: state.repos
  })
  if (clientState.mobileClientTabSelectionsByDeviceId) {
    for (const [deviceId, captured] of Object.entries(
      clientState.mobileClientTabSelectionsByDeviceId
    )) {
      const selections = state.mobileClientTabSelectionsByDeviceId?.[deviceId]
      if (!selections) {
        continue
      }
      for (const ownerKey of Object.keys(captured)) {
        delete selections[ownerKey]
      }
      if (Object.keys(selections).length === 0) {
        delete state.mobileClientTabSelectionsByDeviceId?.[deviceId]
      }
    }
  }
  const target = state.sshTargets.find(
    (entry) => entry.id === requireVshudMigrationSshSource(source).sshTargetId
  )
  if (target && clientState.savedPortForwards) {
    target.portForwards = structuredClone(clientState.savedPortForwards)
  }
  subtractCloseIntents(state, clientState.clientHostedBrowserCloseIntents ?? [], manifest)
  rewriteDesktopUiForDestination(state, manifest, scope)
}

function subtractCloseIntents(
  state: PersistedState,
  captured: readonly NonNullable<
    VshudMigrationClientStatePayload['clientHostedBrowserCloseIntents']
  >[number][],
  manifest: VshudMigrationManifest
): void {
  if (captured.length === 0) {
    return
  }
  const current = state.workspaceSession.clientHostedBrowserCloseIntentsByEnvironment ?? {}
  const next: Record<string, ClientHostedBrowserCloseIntent[]> = Object.fromEntries(
    Object.entries(current).map(([key, entries]) => [key, structuredClone(entries)])
  )
  const destinationEnvironmentId = manifest.destinationEnvironmentId
  if (!destinationEnvironmentId) {
    throw new Error('vshud_migration_source_close_intent_destination_invalid')
  }
  for (const intent of captured) {
    const expected = serializeVshudMigrationValue({
      browserPageId: intent.browserPageId,
      worktreeId: intent.worktreeId,
      closedAt: intent.closedAt
    })
    const samePage = (entry: ClientHostedBrowserCloseIntent): boolean =>
      entry.browserPageId === intent.browserPageId && entry.worktreeId === intent.worktreeId
    const sourceEntries = next[intent.sourceEnvironmentId] ?? []
    const sourceIndex = sourceEntries.findIndex(samePage)
    const destinationEntries = next[destinationEnvironmentId] ?? []
    const existing = destinationEntries.find(samePage)
    if (sourceIndex === -1) {
      // A flushed retry may already have installed the identical destination intent.
      if (existing && serializeVshudMigrationValue(existing) === expected) {
        continue
      }
      throw new Error('vshud_migration_source_close_intent_changed')
    }
    if (serializeVshudMigrationValue(sourceEntries[sourceIndex]) !== expected) {
      throw new Error('vshud_migration_source_close_intent_changed')
    }
    sourceEntries.splice(sourceIndex, 1)
    if (sourceEntries.length === 0) {
      delete next[intent.sourceEnvironmentId]
    } else {
      next[intent.sourceEnvironmentId] = sourceEntries
    }
    if (existing) {
      if (serializeVshudMigrationValue(existing) !== expected) {
        throw new Error('vshud_migration_close_intent_destination_conflict')
      }
      continue
    }
    if (destinationEntries.length >= MAX_CLIENT_HOSTED_BROWSER_CLOSE_INTENTS) {
      throw new Error('vshud_migration_close_intent_destination_capacity_exceeded')
    }
    destinationEntries.push({
      browserPageId: intent.browserPageId,
      worktreeId: intent.worktreeId,
      closedAt: intent.closedAt
    })
    next[destinationEnvironmentId] = destinationEntries
  }
  state.workspaceSession.clientHostedBrowserCloseIntentsByEnvironment = next
}

function rewriteDesktopUiForDestination(
  state: PersistedState,
  manifest: VshudMigrationManifest,
  scope: ReturnType<typeof createVshudMigrationSourceScope>
): void {
  const route = manifest.payload.dormantState?.clientState?.uiRouting
  const destinationEnvironmentId = manifest.destinationEnvironmentId
  if (!route || !destinationEnvironmentId) {
    return
  }
  const destinationHostId = toRuntimeExecutionHostId(destinationEnvironmentId)
  if (
    route.lastActiveWorktreeId &&
    vshudMigrationOwnerMatchesScope(state.ui.lastActiveWorktreeId, scope)
  ) {
    state.ui.lastActiveWorktreeId = composeWorktreeHostIdentity(
      destinationHostId,
      route.lastActiveWorktreeId
    )
  }
  if (route.workspaceHostScope === 'local' && state.ui.workspaceHostScope === scope.hostId) {
    state.ui.workspaceHostScope = destinationHostId
  }
  if (route.visibleWorkspaceHostIds?.includes('local') && state.ui.visibleWorkspaceHostIds) {
    state.ui.visibleWorkspaceHostIds = state.ui.visibleWorkspaceHostIds.map((hostId) =>
      hostId === scope.hostId ? destinationHostId : hostId
    )
  }
  if (route.workspaceHostOrder?.includes('local')) {
    state.ui.workspaceHostOrder = (state.ui.workspaceHostOrder ?? []).map((hostId) =>
      hostId === scope.hostId ? destinationHostId : hostId
    )
  }
  if (route.manualRepoOrder) {
    const repoIds = new Set(route.manualRepoOrder.map((entry) => entry.repoId))
    state.ui.manualRepoOrder = (state.ui.manualRepoOrder ?? []).map((entry) =>
      entry.hostId === scope.hostId && repoIds.has(entry.repoId)
        ? { ...entry, hostId: destinationHostId }
        : entry
    )
  }
  if (route.showDotfilesByWorktree) {
    const next = { ...state.ui.showDotfilesByWorktree }
    for (const [ownerKey, enabled] of Object.entries(next)) {
      if (vshudMigrationOwnerMatchesScope(ownerKey, scope)) {
        delete next[ownerKey]
        next[`${destinationHostId}|${unqualifyVshudMigrationOwnerKey(ownerKey)}`] = enabled
      }
    }
    state.ui.showDotfilesByWorktree = next
  }
  if (route.automationHostFilter?.kind === 'host') {
    const current = parsePersistedAutomationHostFilter(state.ui.automationHostFilter)
    const sourceKey = hostStableKey({
      authority: { kind: 'desktop' },
      selector: { kind: 'ssh', targetId: scope.targetId }
    })
    if (current.kind === 'host' && hostStableKey(current.host) === sourceKey) {
      state.ui.automationHostFilter = structuredClone(route.automationHostFilter)
    }
  }
}
