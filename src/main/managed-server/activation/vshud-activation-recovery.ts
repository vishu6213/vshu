// Reconcile interrupted transactions to the recorded slot and state; retain the fence whenever ownership remains unproven.
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  planVshudTransactionRecovery,
  type VshudActivationTransaction
} from './vshud-activation-transaction'
import { readVshudActivationTransaction } from './vshud-activation-transaction-store'
import {
  readVshudActivationRecord,
  writeVshudActivationRecord
} from './vshud-activation-record-store'
import {
  vshudActivationFenceExists,
  withStaleVshudActivationRecoveryLock
} from './vshud-activation-lock'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'
import { ensureVshudSlotServing, resolveVshudSlotIdentity } from './vshud-recovery-slot'
import { reconcileVshudDecommission } from '../lifecycle/vshud-decommission-recovery'
import {
  recoverVshudIncumbent,
  type VshudIncumbentRecoveryOptions
} from './vshud-incumbent-recovery'
import type { VshudManagedRefusal } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { resumeInterruptedVshudCandidate } from './vshud-interrupted-candidate-resume'
import { errorMessage } from '../../../shared/errors/error-message'
import { isVshudLaunchFailure } from './vshud-launch-failure'

export type VshudActivationRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      readiness: ServeReadiness | null
    }
  /** A launch failure behind an unverifiable refusal still ended a run. */
  | (VshudManagedRefusal & { launchFailure?: Error })

type VshudActivationRecoveryOptions = VshudIncumbentRecoveryOptions

export const VSHUD_RECOVERY_UNVERIFIABLE_CODE = 'vshud_recovery_unverifiable'

/** Both pre-fence answers, read moments ago on this connect; they only skip the same two reads. */
export type VshudActivationIdlePreRead = { transactionAbsent: boolean; fenceOpen: boolean }

export async function recoverInterruptedVshudActivation(
  options: VshudActivationRecoveryOptions,
  preRead?: VshudActivationIdlePreRead
): Promise<VshudActivationRecoveryResult> {
  if (preRead?.transactionAbsent && preRead.fenceOpen) {
    return { outcome: 'none' }
  }
  try {
    if (
      !(await readVshudActivationTransaction(options)) &&
      !(await vshudActivationFenceExists(options))
    ) {
      return { outcome: 'none' }
    }
    return await withStaleVshudActivationRecoveryLock(options, async (lock) => {
      const transaction = await readVshudActivationTransaction(options)
      if (!transaction) {
        // Interrupted release can remove the journal before the fence; finishing release is enough.
        return { outcome: 'none' }
      }
      const result = await reconcileVshudTransaction(options, transaction)
      if (result.outcome !== 'recovered') {
        lock.retain()
      }
      return result
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      return {
        outcome: 'pending',
        code: 'vshud_recovery_transaction_still_fresh',
        reason:
          'The activation fence is held by a run that may still be working. Retry after the ' +
          'install lock recovery window.'
      }
    }
    return {
      outcome: 'refused',
      verdict: 'unverifiable',
      code: VSHUD_RECOVERY_UNVERIFIABLE_CODE,
      reason:
        `The interrupted activation could not be reconciled safely: ${errorMessage(error)} ` +
        'The host remains fenced.',
      ...(isVshudLaunchFailure(error) ? { launchFailure: error } : {})
    }
  }
}

/** Requires a held fence; unverifiable steps throw to preserve it. */
async function reconcileVshudTransaction(
  options: VshudActivationRecoveryOptions,
  transaction: VshudActivationTransaction
): Promise<VshudActivationRecoveryResult> {
  const plan = planVshudTransactionRecovery(transaction, await readVshudActivationRecord(options))
  if (plan.action === 'refuse') {
    return { outcome: 'refused', verdict: 'unverifiable', code: plan.code, reason: plan.reason }
  }
  if (
    plan.action === 'confirm-decommissioned' ||
    plan.action === 'resume-stop' ||
    plan.action === 'keep-serving'
  ) {
    return reconcileVshudDecommission(options, plan)
  }
  if (plan.action === 'finish-commit') {
    await writeVshudActivationRecord(options, plan.record)
  }
  if (plan.action === 'stabilize-committed' || plan.action === 'finish-commit') {
    const activeVersion = plan.action === 'finish-commit' ? plan.record.active : plan.activeVersion
    if (!activeVersion) {
      throw new Error('The committed activation record has no active version.')
    }
    const identity = await resolveVshudSlotIdentity(options, activeVersion)
    return {
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion,
      readiness: await ensureVshudSlotServing(options, identity)
    }
  }
  let launchFailure: Error | undefined
  if (transaction.operation === 'activate' && plan.launchedVersion) {
    const readiness = await resumeInterruptedVshudCandidate(options, transaction)
    if (readiness && 'outcome' in readiness) {
      return readiness
    }
    if (readiness && 'launchFailure' in readiness) {
      launchFailure = readiness.launchFailure
    } else if (readiness) {
      return {
        outcome: 'recovered',
        resolution: 'committed',
        activeVersion: transaction.candidateVersion,
        readiness
      }
    }
  }
  const recovery = await recoverVshudIncumbent(options, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: plan.launchedVersion,
    incumbent: plan.activeVersion
      ? await resolveVshudSlotIdentity(options, plan.activeVersion)
      : null,
    restoreState: plan.restoreState,
    launchedFromState: plan.launchedFromState
  })
  return recovery.outcome === 'refused'
    ? { ...recovery, ...(launchFailure ? { launchFailure } : {}) }
    : {
        outcome: 'recovered',
        resolution: 'restored-incumbent',
        activeVersion: plan.activeVersion,
        readiness: recovery.readiness
      }
}
