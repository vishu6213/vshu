import type { VshudActivationLockControl } from './vshud-activation-lock'
import type { VshudSnapshotVerdict } from './vshud-activation-transaction'
import { vshudStopFreedTheHost } from '../install/vshud-remote-process-control'
import { withoutAbortSignal } from '../install/vshud-remote-runtime-control'
import {
  launchVshudSlot,
  stopVshudSlot,
  VSHUD_SLOT_STOP_WAIT_SECONDS,
  type VshudSlotIdentity,
  type VshudSlotOptions
} from './vshud-recovery-slot'
import { recoverVshudIncumbent } from './vshud-incumbent-recovery'
import { errorMessage } from '../../../shared/errors/error-message'

/** Return null on proven exit; otherwise retain the fence when a delivered stop may still change the host. */
export async function stopTransactionIncumbent(
  options: VshudSlotOptions,
  incumbent: VshudSlotIdentity,
  lock: VshudActivationLockControl
): Promise<{ reason: string; stopMayBeUnderway: boolean } | null> {
  const stopped = await stopVshudSlot(options, incumbent.remoteDir, false)
  if (vshudStopFreedTheHost(stopped)) {
    return null
  }
  // Only a stop that may have been delivered can still change the host; otherwise nothing happened.
  const stopMayBeUnderway = stopped === 'still-running' || stopped === 'unconfirmed'
  if (stopMayBeUnderway) {
    lock.retain()
  }
  return {
    reason:
      `Could not verify that vshud ${incumbent.version} exited within ` +
      `${VSHUD_SLOT_STOP_WAIT_SECONDS}s (${stopped}).`,
    stopMayBeUnderway
  }
}

export async function restartAfterSnapshotFailure(
  options: VshudSlotOptions,
  incumbent: VshudSlotIdentity,
  lock: VshudActivationLockControl
): Promise<string> {
  try {
    await launchVshudSlot(withoutAbortSignal(options), incumbent)
    lock.recovered()
    return `vshud ${incumbent.version} was restarted and is serving again.`
  } catch (error) {
    lock.retain()
    return `restarting vshud ${incumbent.version} failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Restore changed state and incumbent only after both slots prove exit; refusal retains the fence. */
export async function putTransactionIncumbentBack(
  options: VshudSlotOptions,
  lock: VshudActivationLockControl,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: VshudSlotIdentity | null
    restoreState: VshudSnapshotVerdict | null
    launchedFromState?: VshudSnapshotVerdict | null
  }
): Promise<string | null> {
  try {
    const recovery = await recoverVshudIncumbent(withoutAbortSignal(options), {
      ...input,
      slotsProvenExited: true
    })
    if (recovery.outcome === 'refused') {
      lock.retain()
      return recovery.reason
    }
    lock.recovered()
    return null
  } catch (error) {
    lock.retain()
    return `Restoring the previous version failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Stop the rejected candidate before safely restoring incumbent state. */
export async function restoreAfterRejectedCandidate(
  options: VshudSlotOptions,
  lock: VshudActivationLockControl,
  input: {
    launchedDir: string
    launchedVersion: string
    transactionStartedAt: string
    incumbent: VshudSlotIdentity | null
    restoreState: VshudSnapshotVerdict | null
    launchedFromState?: VshudSnapshotVerdict | null
  }
): Promise<string> {
  const { launchedDir, ...restore } = input
  const stopped = await stopVshudSlot(withoutAbortSignal(options), launchedDir, true).catch(
    (error: unknown) => `unverifiable: ${errorMessage(error)}`
  )
  if (stopped !== 'stopped' && stopped !== 'already-exited') {
    lock.retain()
    return (
      `vshud ${input.launchedVersion} could not be confirmed stopped (${stopped}), so nothing ` +
      'was restored over state it may still own. This host requires recovery.'
    )
  }
  const failure = await putTransactionIncumbentBack(options, lock, restore)
  return (
    failure ??
    (input.incumbent
      ? `vshud ${input.incumbent.version} was restarted and is serving again.`
      : 'No previous version was active, so this host is now serving nothing.')
  )
}
