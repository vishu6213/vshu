/** Read-only export preflight: catalog rows and representable dormant state can migrate; ownership, live leases and untransferred dependencies block. */
import { isLiveSshPtyLease } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { Store } from '../../persistence/loading-store/store'
import type {
  VshudMigrationBlocker,
  VshudMigrationPreflight
} from '../../../shared/vshud-migration/vshud-migration-preflight'
import {
  createVshudMigrationManifest,
  type VshudMigrationExportStore
} from '../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import {
  collectTargetCatalogBlockers,
  resolveVshudPreflightTarget
} from './ssh-target-vshud-claims'
import { collectUntransferredDependentBlockers } from './ssh-target-vshud-dependents'
import {
  preservesVshudMigrationBridgedPanes,
  type VshudMigrationPaneLeasePredicate
} from '../migration-source/vshud-migration-bridged-panes'

export type VshudMigrationPreflightStore = VshudMigrationExportStore &
  Pick<
    Store,
    'getSshTarget' | 'getSshRemotePtyLeases' | 'inspectVshudMigrationUntransferredDependencies'
  >

/** `owner` passes the environment's own fence only when its migration journal is on disk. */
export function preflightVshudMigrationExport(
  store: VshudMigrationPreflightStore,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean },
  /** COMPAT(legacy-relay-bridge): leases a bridged proof left running for the bridge. */
  bridgedPtyIds: readonly string[] = []
): VshudMigrationPreflight {
  const resolved = resolveVshudPreflightTarget(store, targetId, owner)
  if ('result' in resolved) {
    return resolved.result
  }
  const { target } = resolved
  const blockers: VshudMigrationBlocker[] = [...collectTargetCatalogBlockers(store, target)]
  const terminalLeases = store
    .getSshRemotePtyLeases(targetId)
    .filter((lease) => isLiveSshPtyLease(lease) && !bridgedPtyIds.includes(lease.ptyId))
    .map(({ ptyId, worktreeId, tabId, leafId, state, updatedAt }) => ({
      ptyId,
      worktreeId,
      tabId,
      leafId,
      state,
      updatedAt
    }))
  if (terminalLeases.length > 0) {
    // A relay PTY cannot move to vshud; its work must finish first.
    blockers.push({
      code: 'vshud_migration_direct_ssh_terminal_leases',
      category: 'live-or-unverifiable',
      terminalLeases
    })
  }
  blockers.push(
    ...collectUntransferredDependentBlockers(store, createVshudMigrationManifest(store, target))
  )
  return {
    targetId,
    targetLabel: target.label,
    claimable: !blockers.some(isBlockingVshudMigrationBlocker),
    blockers
  }
}

/** Confirmed Move anyway can leave saved state, but desktop drafts that cannot be left still block. */
export function leaveBehindClearsVshudMigrationBlockers(
  store: VshudMigrationPreflightStore & Pick<Store, 'createVshudMigrationLeaveBehindView'>,
  targetId: string,
  bridgedPtyIds: readonly string[] = [],
  isBridgedPaneLease?: VshudMigrationPaneLeasePredicate
): boolean {
  const view = store.createVshudMigrationLeaveBehindView(targetId)
  const preflight = preflightVshudMigrationExport(
    {
      ...view,
      getSshTarget: (id) => store.getSshTarget(id),
      getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id)
    },
    targetId,
    undefined,
    bridgedPtyIds
  )
  const target = store.getSshTarget(targetId)
  return (
    preflight.claimable &&
    target !== undefined &&
    preservesVshudMigrationBridgedPanes(
      createVshudMigrationManifest(view, target).payload,
      store.getSshRemotePtyLeases(targetId),
      bridgedPtyIds,
      isBridgedPaneLease
    )
  )
}

/** Only saved state blocks: a confirmed "Move anyway" may leave it on this desktop. */
export function onlyLeavableVshudMigrationBlockers(
  blockers: readonly VshudMigrationBlocker[]
): boolean {
  const blocking = blockers.filter(isBlockingVshudMigrationBlocker)
  return (
    blocking.length > 0 &&
    blocking.every((blocker) => blocker.code === 'vshud_migration_dependent_state')
  )
}

export function isBlockingVshudMigrationBlocker(blocker: VshudMigrationBlocker): boolean {
  return (
    blocker.category !== 'drainable-static-state' &&
    blocker.code !== 'vshud_migration_saved_port_forwards'
  )
}
