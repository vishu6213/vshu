/** Persist journal, fence, then profile flush before remote calls. Crashes may leave a non-authoritative stale journal; a fence without a journal requires destination evidence before release. */
import { randomUUID } from 'node:crypto'
import { getManagedVshudFenceEnvironmentId } from '../../../shared/remote-runtime/ssh/managed-vshud-ssh-owner'
import type { VshudMigrationBlocker } from '../../../shared/vshud-migration/vshud-migration-preflight'
import {
  VSHUD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type VshudMigrationSourceCutover
} from '../../../shared/vshud-migration/vshud-migration-source-cutover'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import { assertVshudMigrationRequestFits } from '../../managed-server/migration/catalog/vshud-migration-request-budget'
import { createVshudMigrationManifest } from '../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import {
  findVshudMigrationSourceCutoverForTarget,
  removeVshudMigrationSourceCutover,
  writeVshudMigrationSourceCutover
} from '../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import {
  confirmVshudMigrationTerminalsUnderFence,
  type VshudMigrationTerminalVerdict
} from './vshud-migration-terminal-gate'
import type { SshTargetVshudClaims } from '../targets/ssh-target-vshud-claims'
import {
  isBlockingVshudMigrationBlocker,
  preflightVshudMigrationExport,
  type VshudMigrationPreflightStore
} from '../targets/ssh-target-vshud-preflight'
import { vshudMigrationRefusalReason } from '../../managed-server/migration/cutover/vshud-migration-refusal-reason'
import {
  preservesVshudMigrationBridgedPanes,
  type VshudMigrationPaneLeasePredicate
} from './vshud-migration-bridged-panes'

export const VSHUD_MIGRATION_LEAVE_BEHIND_TERMINALS = 'vshud_migration_leave_behind_terminals'
export const VSHUD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON =
  'Move anyway needs every terminal on this host closed first, and Vshu could not confirm they all exited. Close them, or end them on the host, then connect again.'

export type VshudMigrationFenceState =
  | { state: 'none' }
  | { state: 'fenced'; cutover: VshudMigrationSourceCutover }
  /** Empty-host deploys record provisioning intent instead of a migration journal. */
  | { state: 'owned-by-deploy'; environmentId: string }
  /** Unexplained ownership requires recovery, never automatic release. */
  | { state: 'fenced-unverifiable'; environmentId: string }
  /** Stale journals grant no staging authority. */
  | { state: 'stale-journal'; cutover: VshudMigrationSourceCutover }

/** Throws when the journal cannot be read: an unreadable record keeps the host fenced. */
export function resolveVshudMigrationFence(
  userDataPath: string,
  target: SshTarget
): VshudMigrationFenceState {
  const cutover = findVshudMigrationSourceCutoverForTarget(userDataPath, target.id)
  const ownerEnvironmentId = getManagedVshudFenceEnvironmentId(target)
  if (cutover) {
    return ownerEnvironmentId === cutover.destinationEnvironmentId &&
      target.generation === cutover.sshTargetGeneration
      ? { state: 'fenced', cutover }
      : { state: 'stale-journal', cutover }
  }
  if (!ownerEnvironmentId) {
    return { state: 'none' }
  }
  return target.vshudProvisioning
    ? { state: 'owned-by-deploy', environmentId: ownerEnvironmentId }
    : { state: 'fenced-unverifiable', environmentId: ownerEnvironmentId }
}

export type VshudMigrationFenceResult =
  | { outcome: 'fenced'; cutover: VshudMigrationSourceCutover; resumed: boolean }
  | {
      outcome: 'refused'
      verdict: 'live' | 'unverifiable'
      code: string
      reason: string
      blockers?: VshudMigrationBlocker[]
    }

export async function fenceVshudMigrationSource(args: {
  userDataPath: string
  store: VshudMigrationPreflightStore
  claims: SshTargetVshudClaims
  targetId: string
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: VshudMigrationTerminalVerdict
  isBridgedPaneLease?: VshudMigrationPaneLeasePredicate
  now?: () => Date
  signal?: AbortSignal
}): Promise<VshudMigrationFenceResult> {
  const target = args.store.getSshTarget(args.targetId)
  if (!target) {
    return refuse('unverifiable', 'vshud_migration_target_not_found', 'The SSH host is gone.')
  }
  const existing = resolveVshudMigrationFence(args.userDataPath, target)
  if (existing.state === 'fenced') {
    return existing.cutover.destinationEnvironmentId === args.destinationEnvironmentId
      ? { outcome: 'fenced', cutover: existing.cutover, resumed: true }
      : refuse('live', 'vshud_migration_in_progress', 'Another migration holds this SSH host.')
  }
  if (existing.state !== 'none') {
    return refuse(
      'unverifiable',
      `vshud_migration_${existing.state.replaceAll('-', '_')}`,
      fenceStateReason(existing)
    )
  }
  const proof = args.terminalProof
  if (proof.verdict !== 'exited' && proof.verdict !== 'bridged') {
    return refuse(proof.verdict, 'vshud_migration_terminals', proof.reason)
  }
  const preflight = preflightVshudMigrationExport(
    args.store,
    target.id,
    undefined,
    proof.verdict === 'bridged' ? proof.bridgedPtyIds : []
  )
  if (!preflight.claimable) {
    return {
      ...refuse(
        // Only a proven blocker reads live; one that is merely unanswered stays unverifiable.
        preflight.blockers
          .filter(isBlockingVshudMigrationBlocker)
          .every((blocker) => blocker.category === 'live-or-unverifiable')
          ? 'unverifiable'
          : 'live',
        'vshud_migration_preflight_blocked',
        vshudMigrationRefusalReason(preflight.blockers)
      ),
      blockers: preflight.blockers
    }
  }
  const generation = args.claims.ensureGeneration(target.id)
  const now = (args.now ?? (() => new Date()))().toISOString()
  const manifest = createVshudMigrationManifest(
    args.store,
    { ...target, generation },
    { migrationId: randomUUID(), destinationEnvironmentId: args.destinationEnvironmentId }
  )
  if (
    proof.verdict === 'bridged' &&
    target.managedServerLeaveBehind &&
    !preservesVshudMigrationBridgedPanes(
      manifest.payload,
      args.store.getSshRemotePtyLeases(target.id),
      proof.bridgedPtyIds,
      args.isBridgedPaneLease
    )
  ) {
    return refuse(
      proof.relayVerdict,
      VSHUD_MIGRATION_LEAVE_BEHIND_TERMINALS,
      VSHUD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON
    )
  }
  // Reject before journaling so an unsendable manifest cannot pin the fence.
  assertVshudMigrationRequestFits({ manifest })
  const cutover: VshudMigrationSourceCutover = {
    version: VSHUD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: manifest.migrationId,
    phase: 'source-fenced',
    startedAt: now,
    updatedAt: now,
    destinationEnvironmentId: args.destinationEnvironmentId,
    destinationName: args.destinationName,
    sshTargetId: target.id,
    sshTargetGeneration: generation,
    manifestSha256: manifest.manifestSha256,
    provenPtyIds: proof.verdict === 'exited' ? proof.provenPtyIds : [],
    ...(proof.verdict === 'bridged' ? { bridgedPtyIds: proof.bridgedPtyIds } : {}),
    // Capture before commit; this journaled export is the evidence of what the destination receives.
    manifest
  }
  writeVshudMigrationSourceCutover(args.userDataPath, cutover)
  args.claims.fenceForMigration(target.id, args.destinationEnvironmentId, generation)
  await args.claims.flush(args.signal)
  // Recheck under fence for terminals started after the original proof.
  const underFence = confirmVshudMigrationTerminalsUnderFence(
    args.store,
    target.id,
    args.terminalProof
  )
  if (underFence.verdict !== 'exited' && underFence.verdict !== 'bridged') {
    await releaseUnstagedFence(args, cutover)
    return refuse(underFence.verdict, 'vshud_migration_terminals', underFence.reason)
  }
  return { outcome: 'fenced', cutover, resumed: false }
}

type FenceReleaseArgs = { userDataPath: string; claims: SshTargetVshudClaims; signal?: AbortSignal }

async function releaseUnstagedFence(
  args: FenceReleaseArgs,
  cutover: VshudMigrationSourceCutover
): Promise<void> {
  if (cutover.phase !== 'source-fenced') {
    throw new Error('vshud_migration_fence_release_after_stage')
  }
  await releaseVshudMigrationFence(args, cutover)
}

/** Drop owner before journal so an interrupted release leaves a harmless stale journal, never unexplained ownership. */
export async function releaseVshudMigrationFence(
  args: FenceReleaseArgs,
  cutover: VshudMigrationSourceCutover
): Promise<void> {
  args.claims.release(cutover.sshTargetId, cutover.destinationEnvironmentId)
  await args.claims.flush(args.signal)
  removeVshudMigrationSourceCutover(args.userDataPath, cutover.migrationId)
}

/** Unregistered destinations could stage nothing; registered destinations must prove durable abort instead. */
export async function releaseUndeployedMigrationFence(args: {
  userDataPath: string
  claims: SshTargetVshudClaims
  targetId: string
  isDestinationRegistered: (environmentId: string) => boolean | Promise<boolean>
  signal?: AbortSignal
}): Promise<'released' | 'none'> {
  const cutover = findVshudMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  if (!cutover) {
    return 'none'
  }
  if (await args.isDestinationRegistered(cutover.destinationEnvironmentId)) {
    throw new Error('vshud_migration_destination_registered')
  }
  await releaseUnstagedFence(args, cutover)
  return 'released'
}

function fenceStateReason(state: VshudMigrationFenceState): string {
  switch (state.state) {
    case 'owned-by-deploy':
      return 'Vshu already runs on this SSH host.'
    case 'fenced-unverifiable':
      return 'This SSH host is held for a migration whose record is missing. Recover it from this host’s Vshu server first.'
    case 'stale-journal':
      return 'A migration record names this SSH host but its fence is gone. Resolve that migration first.'
    case 'fenced':
    case 'none':
      return 'This SSH host is not in a state a migration can start from.'
  }
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<VshudMigrationFenceResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
