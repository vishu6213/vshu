/** Journal only additions made after conversion to the same server; retain the full journal chain and source rows. Stage conflicts leave the changed mark and source intact; uncertain outcomes keep the journal for resume. */
import {
  VSHUD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type VshudMigrationSourceCutover
} from '../../../../shared/vshud-migration/vshud-migration-source-cutover'
import type { VshudDeltaMoveResult } from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { recordManagedVshudMigration } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import type { KnownRuntimeEnvironment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../../shared/remote-runtime/ssh/ssh-types'
import type { Store } from '../../../persistence/loading-store/store'
import {
  abortVshudMigrationCutover,
  commitVshudMigrationDestination,
  type VshudMigrationCutoverContext,
  type VshudMigrationDestinationCatalog
} from './vshud-migration-cutover-coordinator'
import {
  findVshudMigrationSourceCutoverForTarget,
  listVshudMigrationCutoverChainForTarget,
  removeVshudMigrationSourceCutover,
  writeVshudMigrationSourceCutover
} from '../../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import {
  committedVshudMigrationChain,
  vshudDeltaSourceStore,
  planVshudDeltaMove,
  unfinishedVshudDelta,
  type VshudDeltaMovePlan
} from './vshud-migration-delta-plan'
import { assertVshudMigrationRequestFits } from '../catalog/vshud-migration-request-budget'
import { retainVshudMigrationSource } from '../../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-source-retention'
import {
  assessVshudMigrationTerminals,
  type VshudMigrationTerminalVerdict,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from '../../../ssh/migration-source/vshud-migration-terminal-gate'
import {
  currentVshudSourceFingerprint,
  vshudCatalogFingerprint,
  unmovedVshudSourceRows,
  withKeptVshudSourceRows
} from '../../../persistence/migrating-vshud-catalog/retained-source/vshud-retained-source'
import { collectVshudMigrationSourceCatalog } from '../../../persistence/migrating-vshud-catalog/source/catalog/vshud-source-catalog'
import type { SshTargetVshudClaims } from '../../../ssh/targets/ssh-target-vshud-claims'
import { vshudMigrationRefusalReason } from './vshud-migration-refusal-reason'
import { errorMessage } from '../../../../shared/errors/error-message'

type VshudDeltaMoveArgs = {
  userDataPath: string
  store: Store
  claims: SshTargetVshudClaims
  target: SshTarget
  environment: KnownRuntimeEnvironment
  /** Build the destination after opening its tunnel: re-pairing during open can replace commit credentials. */
  connectDestination: () => Promise<VshudMigrationDestinationCatalog>
  /** Host census proves exit or identifies terminals preserved by the legacy bridge. */
  censusHost?: CensusHostRelayTerminals | null
  /** Serialize journal-through-commit with all other lifecycle changes to this host. */
  runTargetLifecycle: <T>(targetId: string, operation: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export async function runVshudDeltaMove(args: VshudDeltaMoveArgs): Promise<VshudDeltaMoveResult> {
  const { userDataPath, store, target } = args
  const now = args.now ?? (() => new Date())
  const plan = planVshudDeltaMove(userDataPath, store, target, { now })
  // Capture baseline with the manifest before awaiting so both describe the same source.
  const planned = currentVshudSourceFingerprint(store, target)
  if (!plan.resumes && plan.added.length === 0) {
    return refuse('vshud_delta_nothing_new', 'An older build added nothing new to move.')
  }
  if (plan.blockers.length > 0) {
    return {
      ...refuse('vshud_migration_preflight_blocked', vshudMigrationRefusalReason(plan.blockers)),
      blockers: plan.blockers
    }
  }
  if (!plan.resumes) {
    // Reject before journaling or an unsendable delta could pin the fence permanently.
    assertVshudMigrationRequestFits({ manifest: plan.manifest })
  }
  const terminals = await assessVshudMigrationTerminals(store, target.id, args.censusHost)
  if (terminals.verdict !== 'exited' && terminals.verdict !== 'bridged') {
    return refuse('vshud_migration_terminals', terminals.reason)
  }
  const settled: SettledTerminals = terminals
  retireProvenExitedLeases(store, target.id, terminals)
  return args.runTargetLifecycle(target.id, async () => {
    // Another move may have journaled or finished while waiting for the lifecycle lock.
    const changedAt = store.getSshTarget(target.id)?.vshudFence?.sourceChangedAt
    const head = findVshudMigrationSourceCutoverForTarget(userDataPath, target.id)
    if (!changedAt || head?.migrationId !== (plan.resumes ?? plan.head).migrationId) {
      return refuse('vshud_delta_superseded', 'Another move of this host ran first.')
    }
    // Source remains writable before fencing; edits during census must not silently become the manifest's baseline.
    if (!plan.resumes && planned !== currentVshudSourceFingerprint(store, target)) {
      return refuse(
        'vshud_delta_source_changed',
        'This host changed while the move was starting. Try the move again.'
      )
    }
    const cutover = plan.resumes ?? journalDelta(args, plan, planned, settled, now)
    return commitDelta(args, plan, cutover, changedAt, now)
  })
}

type SettledTerminals = Extract<VshudMigrationTerminalVerdict, { verdict: 'exited' | 'bridged' }>

function journalDelta(
  args: VshudDeltaMoveArgs,
  plan: VshudDeltaMovePlan,
  planned: string,
  terminals: SettledTerminals,
  now: () => Date
): VshudMigrationSourceCutover {
  const timestamp = now().toISOString()
  const cutover: VshudMigrationSourceCutover = {
    version: VSHUD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: plan.manifest.migrationId,
    phase: 'source-fenced',
    startedAt: timestamp,
    updatedAt: timestamp,
    destinationEnvironmentId: plan.environmentId,
    destinationName: plan.head.destinationName,
    sshTargetId: args.target.id,
    sshTargetGeneration: plan.head.sshTargetGeneration,
    manifestSha256: plan.manifest.manifestSha256,
    provenPtyIds: terminals.verdict === 'exited' ? terminals.provenPtyIds : [],
    // COMPAT(legacy-relay-bridge): a move leaves relay terminals running for the bridge too.
    ...(terminals.verdict === 'bridged' ? { bridgedPtyIds: terminals.bridgedPtyIds } : {}),
    supersedesMigrationId: plan.head.migrationId,
    // Retained rows must match the whole source captured with this manifest.
    sourceBaselineFingerprint: planned,
    manifest: plan.manifest
  }
  writeVshudMigrationSourceCutover(args.userDataPath, cutover)
  return cutover
}

async function commitDelta(
  args: VshudDeltaMoveArgs,
  plan: VshudDeltaMovePlan,
  cutover: VshudMigrationSourceCutover,
  changedAt: string,
  now: () => Date
): Promise<VshudDeltaMoveResult> {
  const { userDataPath, store, target } = args
  // Clear the changed mark and freeze source for the move.
  store.updateSshTarget(target.id, { vshudFence: { environmentId: plan.environmentId } })
  await args.claims.flush()
  // Record before any new/resumed commit so rollback cannot cross the migration.
  await recordManagedVshudMigration(userDataPath, plan.environmentId, now().toISOString())
  let destination: VshudMigrationDestinationCatalog
  try {
    destination = await args.connectDestination()
  } catch (error) {
    // No request reached the server; keep the journal for later resume.
    await restoreChangedMark(args, cutover, changedAt)
    throw error
  }
  const context: VshudMigrationCutoverContext = {
    userDataPath,
    store: plan.source,
    freshSource: () => vshudDeltaSourceStore(store, target, plan.moved, cutover.manifest),
    claims: args.claims,
    destination,
    now
  }
  try {
    const committed = await commitVshudMigrationDestination(context, cutover.migrationId)
    if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
      throw new Error(`vshud_migration_commit_not_proven:${committed.phase}`)
    }
  } catch (error) {
    const released = await releaseUncommittedDelta(args, context, cutover, changedAt)
    if (released === 'released') {
      return refuse('vshud_delta_refused_by_server', errorMessage(error))
    }
    if (released === 'kept') {
      throw error
    }
  }
  await retainVshudMigrationSource(userDataPath, cutover.migrationId, store, now)
  return { outcome: 'moved', migrationId: cutover.migrationId }
}

/** Release only on proven destination absence; otherwise retain journal for resume. Restore the host's changed mark either way. */
async function releaseUncommittedDelta(
  args: VshudDeltaMoveArgs,
  context: VshudMigrationCutoverContext,
  cutover: VshudMigrationSourceCutover,
  changedAt: string
): Promise<'released' | 'committed' | 'kept'> {
  const restoreMark = (): Promise<void> => restoreChangedMark(args, cutover, changedAt)
  try {
    const result = await abortVshudMigrationCutover(context, cutover.migrationId, async () => {
      // Restore the mark first so a crash during journal removal leaves a resumable marked host.
      await restoreMark()
      removeVshudMigrationSourceCutover(args.userDataPath, cutover.migrationId)
    })
    return result.outcome === 'released' ? 'released' : 'committed'
  } catch {
    await restoreMark()
    return 'kept'
  }
}

async function restoreChangedMark(
  args: Pick<VshudDeltaMoveArgs, 'store' | 'claims'>,
  cutover: VshudMigrationSourceCutover,
  changedAt: string
): Promise<void> {
  args.store.updateSshTarget(cutover.sshTargetId, {
    vshudFence: { environmentId: cutover.destinationEnvironmentId, sourceChangedAt: changedAt }
  })
  await args.claims.flush()
}

/** Keep older-build changes only in retained profile rows. */
export async function keepVshudServerVersion(args: {
  userDataPath: string
  store: Store
  claims: SshTargetVshudClaims
  target: SshTarget
}): Promise<void> {
  const environmentId = args.target.vshudFence?.environmentId
  const chain = listVshudMigrationCutoverChainForTarget(args.userDataPath, args.target.id)
  if (unfinishedVshudDelta(chain)) {
    // Unfinished moves may already have copied rows; only commit/abort can decide.
    throw new Error('vshud_delta_move_unfinished')
  }
  const head = committedVshudMigrationChain(chain).at(-1)
  if (!environmentId || !args.target.vshudFence?.sourceChangedAt || !head) {
    throw new Error('vshud_delta_not_changed')
  }
  const current = collectVshudMigrationSourceCatalog(args.store, args.target)
  const unmoved = unmovedVshudSourceRows(current, committedVshudMigrationChain(chain))
  writeVshudMigrationSourceCutover(args.userDataPath, {
    ...withKeptVshudSourceRows(head, unmoved),
    // Explicit reconcile accepts the current retained source as the new baseline.
    sourceBaselineFingerprint: vshudCatalogFingerprint(current)
  })
  args.store.updateSshTarget(args.target.id, { vshudFence: { environmentId } })
  await args.claims.flush()
}

function refuse(
  code: string,
  reason: string
): Extract<VshudDeltaMoveResult, { outcome: 'refused' }> {
  return { outcome: 'refused', code, reason }
}
