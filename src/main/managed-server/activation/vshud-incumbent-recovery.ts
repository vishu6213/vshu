/** Restore changed state only after proven slot exit and operator consent: a launched RPC server may have created terminals the stopped host cannot census, making the snapshot stale. Use the same rule for failure and crash recovery. */
import { execVshudStateMutation } from '../host-state/vshud-state-mutation-exec'
import { vshudRemoteBaseDir } from '../install/vshud-remote-windows-node'
import type { ServeReadiness } from '../../server/serve-readiness'
import { RELAY_REMOTE_DIR } from '../install/remote-install-root'
import { VSHUD_STATE_SNAPSHOT_DIR } from './vshud-activation-record'
import type { VshudSnapshotVerdict } from './vshud-activation-transaction'
import {
  clearVshudStateSnapshotMembersCommand,
  compareVshudStateSnapshotCommand,
  vshudSnapshotIsUnchanged,
  parseVshudSnapshotRestore,
  restoreVshudStateSnapshotCommand
} from '../host-state/vshud-state-snapshot'
import { execVshudRemote } from '../install/vshud-remote-runtime-control'
import {
  ensureVshudSlotServing,
  launchVshudSlot,
  quiesceInterruptedVshudSlot,
  type VshudSlotIdentity,
  type VshudSlotOptions
} from './vshud-recovery-slot'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { VSHUD_RECOVERY_CHANGED_STATE_CODE } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'

export type VshudIncumbentRecoveryOptions = VshudSlotOptions & {
  /** The operator accepted restoring the snapshot over state a launched build changed. */
  acceptChangedState?: boolean
}

type VshudIncumbentRecovery =
  | { outcome: 'restored'; readiness: ServeReadiness | null }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export function vshudSnapshotPath(options: VshudSlotOptions, dirName: string): string {
  return joinRemotePath(
    options.host,
    options.remoteHome,
    RELAY_REMOTE_DIR,
    VSHUD_STATE_SNAPSHOT_DIR,
    dirName
  )
}

/** Unverifiable steps throw so the caller retains the fence. */
export async function recoverVshudIncumbent(
  options: VshudIncumbentRecoveryOptions,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: VshudSlotIdentity | null
    restoreState: VshudSnapshotVerdict | null
    /** Rollback may restore a different snapshot from the launched slot's starting state. */
    launchedFromState?: VshudSnapshotVerdict | null
    /** This run itself proved both slots exited, so no fresh liveness probe is needed. */
    slotsProvenExited?: boolean
  }
): Promise<VshudIncumbentRecovery> {
  const quiescence =
    input.slotsProvenExited || !input.restoreState
      ? 'exited'
      : await quiesceInterruptedVshudSlot(options, input.launchedVersion, input.incumbent)
  // With no incumbent there is no older reader to protect; the record names nothing to serve.
  if (quiescence === 'exited' && input.restoreState && input.incumbent) {
    const decision = input.launchedVersion
      ? await decideChangedStateRestore(options, input.launchedFromState ?? input.restoreState)
      : 'restore'
    if (decision !== 'restore' && decision !== 'unchanged') {
      return decision
    }
    // A launched slot that left its starting state untouched still sits on a root to replace.
    if (decision === 'restore' || input.launchedFromState) {
      await restoreState(options, input.restoreState)
    }
  }
  if (!input.incumbent) {
    return { outcome: 'restored', readiness: null }
  }
  return {
    outcome: 'restored',
    readiness: input.slotsProvenExited
      ? await launchVshudSlot(options, input.incumbent)
      : await ensureVshudSlotServing(options, input.incumbent)
  }
}

async function decideChangedStateRestore(
  options: VshudIncumbentRecoveryOptions,
  state: VshudSnapshotVerdict
): Promise<'unchanged' | 'restore' | Extract<VshudIncumbentRecovery, { outcome: 'refused' }>> {
  if (state.state === 'captured') {
    const snapshotDir = vshudSnapshotPath(options, state.dirName)
    // A lost read-only comparison can conservatively mean changed.
    const comparison = await execVshudRemote(
      options,
      compareVshudStateSnapshotCommand(
        options.host,
        options.userDataDir,
        snapshotDir,
        vshudRemoteBaseDir(options.host, options.remoteHome)
      )
    ).catch(() => '')
    if (vshudSnapshotIsUnchanged(comparison)) {
      return 'unchanged'
    }
  }
  if (options.acceptChangedState) {
    return 'restore'
  }
  const retained =
    state.state === 'captured' ? ` at ${vshudSnapshotPath(options, state.dirName)}` : ''
  return {
    outcome: 'refused',
    verdict: 'unverifiable',
    code: VSHUD_RECOVERY_CHANGED_STATE_CODE,
    reason:
      'The launched build is stopped, but it changed profile state (or the change could not be ' +
      'checked), so the previous build was not restarted against it and this host serves ' +
      'nothing. Recover to restore the prelaunch snapshot' +
      `${retained} and restart the previous build; terminals the launched build started keep ` +
      'running but drop out of the restored state.'
  }
}

async function restoreState(options: VshudSlotOptions, state: VshudSnapshotVerdict): Promise<void> {
  if (state.state === 'pending') {
    throw new Error('The interrupted transaction has no durable snapshot verdict.')
  }
  const command =
    state.state === 'captured'
      ? restoreVshudStateSnapshotCommand(
          options.host,
          options.userDataDir,
          vshudSnapshotPath(options, state.dirName),
          vshudRemoteBaseDir(options.host, options.remoteHome)
        )
      : clearVshudStateSnapshotMembersCommand(
          options.host,
          options.userDataDir,
          vshudRemoteBaseDir(options.host, options.remoteHome)
        )
  const restored = parseVshudSnapshotRestore(await execVshudStateMutation(options, command))
  if (restored !== 'restored') {
    throw new Error(`The prelaunch state could not be restored (${restored}).`)
  }
}
