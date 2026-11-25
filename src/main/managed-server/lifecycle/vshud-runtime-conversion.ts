// Resume journaled migrations after lost contact; source rows stay authoritative until proven commit.
// Retain source rows afterwards for downgrade compatibility.
import { randomUUID } from 'node:crypto'
import type { VshudManagedConversionResult } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type { VshudMigrationSourceCutover } from '../../../shared/vshud-migration/vshud-migration-source-cutover'
import { recordManagedVshudMigration } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  getVshudSshDeployment,
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { environmentMatchesManagedVshudCutover } from './vshud-managed-migration-status'
import { requireManagedVshudInfrastructure } from './vshud-managed-runtime-context'
import { ensureVshudManagedTunnel } from './vshud-managed-tunnel'
import {
  commitVshudMigrationDestination,
  type VshudMigrationDestinationCatalog
} from '../migration/cutover/vshud-migration-cutover-coordinator'
import {
  findVshudMigrationSourceCutoverForTarget,
  removeVshudMigrationJournalsForDestination
} from '../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { CensusHostRelayTerminals } from '../../ssh/migration-source/vshud-migration-terminal-gate'
import { createManagedVshudEnvironment } from './vshud-runtime-deployment'
import { createSshRelayMigrationSource } from '../../ssh/migration-source/vshud-migration-ssh-relay-source'
import {
  leaveBehindClearsVshudMigrationBlockers,
  onlyLeavableVshudMigrationBlockers
} from '../../ssh/targets/ssh-target-vshud-preflight'
import { VSHUD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON } from '../../ssh/migration-source/vshud-migration-source-fence'
import type { VshudMigrationPaneLeasePredicate } from '../../ssh/migration-source/vshud-migration-bridged-panes'
import { retainVshudMigrationSource } from '../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-source-retention'
import {
  enableMovedVshudAutomations,
  type EnableServerAutomation
} from '../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-moved-automations'
import {
  linkedVshudMigrationCutoverPort,
  linkedVshudMigrationProjects,
  linkServerHeldRepositories
} from '../migration/linking/vshud-migration-repository-link'
import type { VshudServerRepository } from '../migration/linking/vshud-server-repositories'
import type { VshudServerFolderCatalog } from '../migration/linking/vshud-server-folder-workspaces'

export type VshudManagedConversionArgs = {
  sshTargetId: string
  name: string
  censusHost?: ((target: SshTarget) => ReturnType<CensusHostRelayTerminals>) | null
  isBridgedPaneLease?: VshudMigrationPaneLeasePredicate
  destinationFor: (environment: KnownRuntimeEnvironment) => VshudMigrationDestinationCatalog
  /** Link matching host paths to existing server projects. */
  serverRepositoriesFor?: (environment: KnownRuntimeEnvironment) => Promise<VshudServerRepository[]>
  /** Link folder workspaces already present from earlier moves. */
  serverFolderCatalogFor?: (
    environment: KnownRuntimeEnvironment
  ) => Promise<VshudServerFolderCatalog>
  releaseDirectSession?: (sshTargetId: string) => Promise<void>
  /** Re-enables moved automations that ran on this desktop. */
  serverAutomationEnablerFor?: (environment: KnownRuntimeEnvironment) => EnableServerAutomation
  now?: () => Date
  signal?: AbortSignal
}

export async function convertSshTargetToManagedVshud(
  userDataPath: string,
  args: VshudManagedConversionArgs
): Promise<VshudManagedConversionResult> {
  const fenced = await fenceOrResume(userDataPath, args)
  if ('outcome' in fenced) {
    return fenced
  }
  const deployed = await createManagedVshudEnvironment(userDataPath, {
    name: fenced.destinationName,
    sshTargetId: fenced.sshTargetId,
    migration: true,
    signal: args.signal
  })
  if (deployed.outcome === 'deferred') {
    return deployed // Retain fence and journal for a later resume.
  }
  const environment = (await listEnvironments(userDataPath)).find(
    (entry) => entry.id === fenced.destinationEnvironmentId
  )
  if (!environment || !environmentMatchesManagedVshudCutover(environment, fenced)) {
    throw new Error('vshud_migration_destination_environment_mismatch')
  }
  // Record before commit so crashes cannot allow rollback across migrated state.
  await recordManagedVshudMigration(
    userDataPath,
    environment.id,
    (args.now ?? (() => new Date()))().toISOString()
  )
  // Tunnel repair may replace pairing credentials; use its returned environment for every request.
  const marked = await ensureVshudManagedTunnel(userDataPath, environment.id)
  const { claims, targetStore } = requireManagedVshudInfrastructure()
  const store = targetStore.getVshudMigrationSource()
  const destination = args.destinationFor(marked)
  const serverRepositoriesFor = args.serverRepositoriesFor
  const serverFolderCatalogFor = args.serverFolderCatalogFor
  let linked: Pick<
    VshudMigrationSourceCutover,
    'linkedRepositoryIds' | 'linkedFolderWorkspaceIds'
  > = {}
  const committed = await runTargetLifecycle(fenced.sshTargetId, async () => {
    const journaled = requireJournaledCutover(userDataPath, fenced)
    const cutover = serverRepositoriesFor
      ? await linkServerHeldRepositories({
          userDataPath,
          store,
          claims,
          cutover: journaled,
          destination,
          serverRepositories: () => serverRepositoriesFor(marked),
          ...(serverFolderCatalogFor
            ? { serverFolderCatalog: () => serverFolderCatalogFor(marked) }
            : {}),
          now: args.now
        })
      : journaled
    linked = cutover
    return commitVshudMigrationDestination(
      {
        userDataPath,
        store,
        claims,
        source: linkedVshudMigrationCutoverPort({ userDataPath, store, claims, cutover }),
        destination,
        now: args.now
      },
      cutover.migrationId
    )
  })
  if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
    throw new Error(`vshud_migration_commit_not_proven:${committed.phase}`)
  }
  let automationsLeftDisabled = 0
  if (committed.phase === 'destination-committed') {
    await retainVshudMigrationSource(userDataPath, committed.migrationId, store, args.now)
    if (args.serverAutomationEnablerFor) {
      automationsLeftDisabled = await enableMovedVshudAutomations(
        userDataPath,
        committed.migrationId,
        args.serverAutomationEnablerFor(marked)
      ).catch((error: unknown) => {
        console.warn('[ssh] Could not re-enable moved automations:', error)
        return 0
      })
    }
  }
  const linkedProjects = linkedVshudMigrationProjects(store, linked)
  return {
    outcome: 'converted',
    environment: redactRuntimeEnvironment(marked),
    migrationId: committed.migrationId,
    ...(linkedProjects.length > 0 ? { linkedProjects } : {}),
    ...(automationsLeftDisabled > 0 ? { automationsLeftDisabled } : {})
  }
}

async function fenceOrResume(
  userDataPath: string,
  args: VshudManagedConversionArgs
): Promise<
  VshudMigrationSourceCutover | Extract<VshudManagedConversionResult, { outcome: 'refused' }>
> {
  const { claims, targetStore } = requireManagedVshudInfrastructure()
  const target = targetStore.getTarget(args.sshTargetId)
  if (!target) {
    return refuse('unverifiable', 'vshud_migration_target_not_found', 'The SSH host is gone.')
  }
  const store = targetStore.getVshudMigrationSource()
  const censusHost = args.censusHost
  const source = createSshRelayMigrationSource({
    userDataPath,
    store,
    claims,
    target,
    censusHost: censusHost ? () => censusHost(target) : null,
    isBridgedPaneLease: args.isBridgedPaneLease
  })
  const existing = source.resolveFence()
  if (existing.state === 'fenced') {
    return existing.cutover
  }
  const stale = existing.state === 'stale-journal' ? existing.cutover : null
  if (stale && !(await isRegistered(userDataPath, stale.destinationEnvironmentId))) {
    removeVshudMigrationJournalsForDestination(
      userDataPath,
      target.id,
      stale.destinationEnvironmentId
    )
  }
  const converted = (await listEnvironments(userDataPath)).some(
    (environment) => getVshudSshDeployment(environment)?.sshTargetId === target.id
  )
  if (converted) {
    return refuse('live', 'vshud_migration_already_managed', 'Vshu already runs on this SSH host.')
  }
  // Source fencing rechecks leases after acquisition.
  const terminalProof = await source.assessTerminals()
  if (terminalProof.verdict === 'live' || terminalProof.verdict === 'unverifiable') {
    return refuse(terminalProof.verdict, 'vshud_migration_terminals', terminalProof.reason)
  }
  source.retireProvenExitedTerminals(terminalProof)
  await args.releaseDirectSession?.(target.id)
  const result = await runTargetLifecycle(target.id, () =>
    source.acquireFence({
      destinationEnvironmentId: randomUUID(),
      destinationName: args.name,
      terminalProof,
      now: args.now,
      signal: args.signal
    })
  )
  if (result.outcome === 'fenced') {
    return result.cutover
  }
  if (result.blockers?.length) {
    // Surface blocked state in logs because connect shows only the summary reason.
    console.warn(
      '[ssh] Conversion refused by:',
      JSON.stringify(
        result.blockers.map((blocker) =>
          'dependencies' in blocker
            ? { code: blocker.code, dependencies: blocker.dependencies }
            : { code: blocker.code }
        )
      )
    )
  }
  const leavable =
    result.blockers &&
    onlyLeavableVshudMigrationBlockers(result.blockers) &&
    !target.managedServerLeaveBehind
  const canLeaveBehind =
    leavable &&
    leaveBehindClearsVshudMigrationBlockers(
      store,
      target.id,
      terminalProof.verdict === 'bridged' ? terminalProof.bridgedPtyIds : [],
      args.isBridgedPaneLease
    )
  if (leavable && terminalProof.verdict !== 'exited' && !canLeaveBehind) {
    // Leaving tabs behind would strand terminals still served by the legacy bridge.
    return refuse(
      result.verdict,
      result.code,
      `${result.reason} ${VSHUD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON}`
    )
  }
  return {
    ...refuse(result.verdict, result.code, result.reason),
    // Preview confirmation to avoid offering an export the confirmed path would refuse.
    ...(canLeaveBehind ? { canLeaveBehind: true } : {})
  }
}

function requireJournaledCutover(
  userDataPath: string,
  fenced: VshudMigrationSourceCutover
): VshudMigrationSourceCutover {
  const journaled = findVshudMigrationSourceCutoverForTarget(userDataPath, fenced.sshTargetId)
  if (journaled?.migrationId !== fenced.migrationId) {
    throw new Error('vshud_migration_source_fence_lost')
  }
  return journaled
}

async function isRegistered(userDataPath: string, environmentId: string): Promise<boolean> {
  return (await listEnvironments(userDataPath)).some(
    (environment) => environment.id === environmentId
  )
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<VshudManagedConversionResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
