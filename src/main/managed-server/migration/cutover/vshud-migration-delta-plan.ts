/** Subtract earlier migrations' currently retained rows/state; export only additions. Never merge overlapping old source copies over server-owned state. */
import type {
  VshudDeltaMovePreview,
  VshudDeltaMoveRow
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type {
  VshudMigrationCatalogPayload,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  isRetainedVshudMigrationSourceCutover,
  type VshudMigrationSourceCutover
} from '../../../../shared/vshud-migration/vshud-migration-source-cutover'

import type { SshTarget } from '../../../../shared/remote-runtime/ssh/ssh-types'
import type { Store } from '../../../persistence/loading-store/store'
import { collectVshudMigrationSourceCatalog } from '../../../persistence/migrating-vshud-catalog/source/catalog/vshud-source-catalog'
import { listVshudMigrationCutoverChainForTarget } from '../../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import {
  createVshudMigrationManifest,
  vshudMigrationCatalogIds,
  type VshudMigrationCatalogIds
} from '../../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import type { VshudMigrationSnapshotSource } from '../transfers/vshud-migration-snapshot-coordinator'
import { collectUntransferredDependentBlockers } from '../../../ssh/targets/ssh-target-vshud-dependents'
import type { VshudMigrationPreflightStore } from '../../../ssh/targets/ssh-target-vshud-preflight'

export type VshudDeltaSourceStore = VshudMigrationPreflightStore & VshudMigrationSnapshotSource

export function unfinishedVshudDelta(
  chain: readonly VshudMigrationSourceCutover[]
): VshudMigrationSourceCutover | null {
  const head = chain.at(-1)
  return head?.supersedesMigrationId &&
    head.phase !== 'source-retired' &&
    !isRetainedVshudMigrationSourceCutover(head)
    ? head
    : null
}

export function committedVshudMigrationChain(
  chain: readonly VshudMigrationSourceCutover[]
): VshudMigrationSourceCutover[] {
  return (unfinishedVshudDelta(chain) ? chain.slice(0, -1) : chain).filter(
    (cutover) => cutover.phase === 'destination-committed' || cutover.phase === 'source-retired'
  )
}

export function vshudDeltaSourceStore(
  store: Store,
  target: SshTarget,
  moved: readonly VshudMigrationSourceCutover[],
  /** Older interrupted deltas may still include server-owned groups. */
  journaled?: VshudMigrationManifest
): VshudDeltaSourceStore {
  const ids = vshudMigrationCatalogIds(moved.map((cutover) => cutover.manifest.payload))
  // Never move projects/groups already owned through earlier links.
  const linked = moved.flatMap((cutover) => cutover.linkedRepositoryIds ?? [])
  const linkedGroups = moved.flatMap((cutover) => cutover.linkedProjectGroupIds ?? [])
  const linkedFolders = moved.flatMap((cutover) => cutover.linkedFolderWorkspaceIds ?? [])
  // New rows reference server-owned groups; exporting retained copies could overwrite newer server edits.
  const serverGroups = new Set([...ids.projectGroupIds, ...linkedGroups])
  const exported = new Set(journaled?.payload.projectGroups.map((group) => group.id))
  return vshudSourceStoreWithout(
    store,
    target,
    {
      ...ids,
      repositoryIds: new Set([...ids.repositoryIds, ...linked]),
      folderWorkspaceIds: new Set([...ids.folderWorkspaceIds, ...linkedFolders]),
      projectGroupIds: serverGroups
    },
    moved.at(-1)?.destinationEnvironmentId,
    new Set([...serverGroups].filter((id) => !exported.has(id)))
  )
}

export function vshudSourceStoreWithout(
  store: Store,
  target: SshTarget,
  owned: VshudMigrationCatalogIds,
  destinationEnvironmentId: string | undefined,
  /** Groups the server's record wins for: never exported, even while a moving row sits in one. */
  serverGroupIds: ReadonlySet<string> = new Set()
): VshudDeltaSourceStore {
  const ownedNow = createVshudMigrationManifest(store, target, {
    destinationEnvironmentId,
    onlyCatalog: owned
  })
  const view = store.createVshudMigrationDeltaView(ownedNow)
  return {
    ...view,
    serverOwnedProjectGroupIds: serverGroupIds,
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    readVshudMigrationSourceSnapshotChunk: (...args) =>
      store.readVshudMigrationSourceSnapshotChunk(...args)
  }
}

export type VshudDeltaMovePlan = VshudDeltaMovePreview & {
  manifest: VshudMigrationManifest
  moved: VshudMigrationSourceCutover[]
  head: VshudMigrationSourceCutover
  resumes: VshudMigrationSourceCutover | null
  source: VshudDeltaSourceStore
}

export function planVshudDeltaMove(
  userDataPath: string,
  store: Store,
  target: SshTarget,
  options: { migrationId?: string; now?: () => Date } = {}
): VshudDeltaMovePlan {
  const environmentId = target.vshudFence?.environmentId
  if (!environmentId || !target.vshudFence?.sourceChangedAt) {
    throw new Error('vshud_delta_not_changed')
  }
  const chain = listVshudMigrationCutoverChainForTarget(userDataPath, target.id)
  const resumes = unfinishedVshudDelta(chain)
  const moved = committedVshudMigrationChain(chain)
  const head = chain.at(resumes ? -2 : -1)
  if (
    !head ||
    !isRetainedVshudMigrationSourceCutover(head) ||
    moved.at(-1)?.migrationId !== head.migrationId
  ) {
    throw new Error('vshud_delta_no_retained_migration')
  }
  const source = vshudDeltaSourceStore(store, target, moved, resumes?.manifest)
  const manifest =
    resumes?.manifest ??
    createVshudMigrationManifest(source, target, {
      migrationId: options.migrationId,
      now: options.now,
      destinationEnvironmentId: environmentId
    })
  const current = collectVshudMigrationSourceCatalog(store, target)
  return {
    sshTargetId: target.id,
    environmentId,
    added: catalogRows(manifest.payload),
    notReflected: notReflected(
      current,
      moved.map((cutover) => cutover.manifest.payload)
    ),
    blockers: collectUntransferredDependentBlockers(source, manifest),
    manifest,
    moved,
    head,
    resumes,
    source
  }
}

function catalogRows(catalog: VshudMigrationCatalogPayload): VshudDeltaMoveRow[] {
  return [
    ...catalog.repositories.map((row) => ({
      kind: 'repository' as const,
      id: row.id,
      label: row.displayName
    })),
    ...catalog.folderWorkspaces.map((row) => ({
      kind: 'folder-workspace' as const,
      id: row.id,
      label: row.name
    })),
    ...catalog.projectGroups.map((row) => ({
      kind: 'project-group' as const,
      id: row.id,
      label: row.name
    }))
  ]
}

/** Rows earlier migrations moved that an older build has since changed or removed. */
function notReflected(
  current: VshudMigrationCatalogPayload,
  movedPayloads: readonly VshudMigrationCatalogPayload[]
): VshudDeltaMovePreview['notReflected'] {
  const latestMoved = new Map<string, { row: VshudDeltaMoveRow; identity: string }>()
  for (const payload of movedPayloads) {
    for (const row of catalogRows(payload)) {
      latestMoved.set(`${row.kind}:${row.id}`, { row, identity: identityOf(payload, row) })
    }
  }
  const currentByKey = new Map(
    catalogRows(current).map((row) => [`${row.kind}:${row.id}`, identityOf(current, row)])
  )
  const edited: VshudDeltaMoveRow[] = []
  const removed: VshudDeltaMoveRow[] = []
  for (const [key, moved] of latestMoved) {
    const identity = currentByKey.get(key)
    if (identity === undefined) {
      removed.push(moved.row)
    } else if (identity !== moved.identity) {
      edited.push(moved.row)
    }
  }
  return { edited, removed }
}

function identityOf(catalog: VshudMigrationCatalogPayload, row: VshudDeltaMoveRow): string {
  switch (row.kind) {
    case 'repository': {
      const repo = catalog.repositories.find((entry) => entry.id === row.id)
      return `${repo?.path}\0${repo?.displayName}`
    }
    case 'folder-workspace': {
      const folder = catalog.folderWorkspaces.find((entry) => entry.id === row.id)
      return `${folder?.folderPath}\0${folder?.name}`
    }
    case 'project-group':
      return catalog.projectGroups.find((entry) => entry.id === row.id)?.name ?? ''
  }
}
