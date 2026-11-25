/** Resume through the original readiness gate before undoing: the candidate may already serve changed state, and stopping it could require operator consent before anything can serve again. */
import type { ServeReadiness } from '../../server/serve-readiness'
import { withActivatedVersion } from './vshud-activation-record'
import { writeVshudActivationRecord } from './vshud-activation-record-store'
import type { VshudActivateTransaction } from './vshud-activation-transaction'
import { writeVshudActivationTransaction } from './vshud-activation-transaction-store'
import { withVshudActivationCandidateReady } from './vshud-activation-transaction-transitions'
import { VshudActiveReadinessError } from './vshud-active-readiness'
import { vshudLivenessProvenExited } from '../install/vshud-remote-launch'
import {
  VSHUD_RECOVERY_CHANGED_STATE_CODE,
  type VshudManagedRefusal
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import {
  ensureVshudSlotServing,
  vshudSlotDir,
  resolveVshudSlotIdentity,
  slotLiveness
} from './vshud-recovery-slot'
import type { VshudIncumbentRecoveryOptions } from './vshud-incumbent-recovery'
import { isVshudLaunchFailure } from './vshud-launch-failure'

/** Under the held fence, return null (or the candidate's launch failure) for undo; a refusal leaves the host untouched for an operator. */
export async function resumeInterruptedVshudCandidate(
  options: VshudIncumbentRecoveryOptions,
  transaction: VshudActivateTransaction
): Promise<ServeReadiness | VshudManagedRefusal | { launchFailure: Error } | null> {
  const snapshotState = transaction.snapshot.state
  const incumbent = transaction.recordBefore.active
  if (
    transaction.phase !== 'snapshot-captured' ||
    snapshotState === 'pending' ||
    // A serving incumbent holds the port and instance lock; undo keeps it.
    (incumbent !== null &&
      !vshudLivenessProvenExited(await slotLiveness(options, vshudSlotDir(options, incumbent))))
  ) {
    return null
  }
  const candidate = await resolveVshudSlotIdentity(options, transaction.candidateVersion)
  const candidateLiveness = await slotLiveness(options, candidate.remoteDir)
  // Old journals lack candidate app version, so commit would drop downgrade protection; undo a possibly serving candidate only with consent.
  if (transaction.candidateAppVersion === undefined) {
    if (vshudLivenessProvenExited(candidateLiveness) || options.acceptChangedState) {
      return null
    }
    if (candidateLiveness === 'UNKNOWN') {
      throw new Error(`Could not tell whether vshud ${transaction.candidateVersion} is running.`)
    }
    return {
      outcome: 'refused',
      verdict: 'live',
      code: VSHUD_RECOVERY_CHANGED_STATE_CODE,
      reason:
        `An older Vshu left version ${transaction.candidateVersion} running without finishing ` +
        'its update, and did not record which app started it, so it was neither committed nor ' +
        'stopped. Recover to stop it, restore the prelaunch snapshot and restart the previous ' +
        'build; what it changed is discarded.'
    }
  }
  // Undo must rule out an unprovable candidate before starting another slot.
  if (candidateLiveness === 'UNKNOWN') {
    return null
  }
  let readiness: ServeReadiness
  try {
    readiness = await ensureVshudSlotServing(options, candidate)
  } catch (error) {
    // Only candidate evidence permits undo; unanswered hosts retain the fence.
    if (error instanceof VshudActiveReadinessError && error.verdict !== 'unverifiable') {
      // Undo still follows; the failed candidate launch is a failed run all the same.
      return isVshudLaunchFailure(error) ? { launchFailure: error } : null
    }
    throw error
  }
  const now = new Date()
  const recordAfter = withActivatedVersion(
    transaction.recordBefore,
    transaction.candidateVersion,
    snapshotState === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: transaction.candidateVersion,
          readableByVersion: incumbent,
          takenAt: transaction.startedAt
        }
      : null,
    now,
    transaction.candidateAppVersion ?? undefined
  )
  await writeVshudActivationTransaction(
    options,
    withVshudActivationCandidateReady(transaction, recordAfter, now)
  )
  await writeVshudActivationRecord(options, recordAfter)
  return readiness
}
