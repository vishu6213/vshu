// Only process-exited may commit; dispatched phases nest under prepared for released readers.
import {
  serializeVshudActivationRecord,
  withDeactivatedVersion,
  withDeactivatedVersionCommitted,
  type VshudActivationRecord
} from '../activation/vshud-activation-record'
import { VSHUD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from '../activation/vshud-activation-transaction-schema'
import type { VshudManagedStopRequest } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'

export type VshudDecommissionTransaction = {
  schemaVersion: typeof VSHUD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'decommission'
  phase: 'prepared' | 'stop-dispatched' | 'process-exited'
  startedAt: string
  updatedAt: string
  activeVersion: string
  recordBefore: VshudActivationRecord
  recordAfter: VshudActivationRecord
  request: VshudManagedStopRequest | null
}

/** Released desktops drop this field. */
type VshudDecommissionDispatch = {
  phase: 'stop-dispatched' | 'process-exited'
  request: VshudManagedStopRequest
}

type VshudDecommissionJournal = Omit<VshudDecommissionTransaction, 'phase' | 'request'> & {
  phase: 'prepared'
  request: null
  dispatched?: VshudDecommissionDispatch
}

export type VshudDecommissionRecoveryPlan =
  | { action: 'confirm-decommissioned'; version: string; record: VshudActivationRecord | null }
  /** Completion or cancellation must settle a possibly delivered request. */
  | { action: 'resume-stop'; request: VshudManagedStopRequest; record: VshudActivationRecord }
  | { action: 'keep-serving'; version: string }

export function createVshudDecommissionTransaction(options: {
  transactionId: string
  recordBefore: VshudActivationRecord & { active: string }
  now: Date
}): VshudDecommissionTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: VSHUD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'decommission',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    activeVersion: options.recordBefore.active,
    recordBefore: options.recordBefore,
    recordAfter: withDeactivatedVersion(options.recordBefore),
    request: null
  }
}

export function withVshudDecommissionStopDispatched(
  transaction: VshudDecommissionTransaction,
  request: VshudManagedStopRequest,
  now: Date
): VshudDecommissionTransaction {
  return { ...transaction, phase: 'stop-dispatched', updatedAt: now.toISOString(), request }
}

export function withVshudDecommissionProcessExited(
  transaction: VshudDecommissionTransaction,
  now: Date
): VshudDecommissionTransaction {
  return { ...transaction, phase: 'process-exited', updatedAt: now.toISOString() }
}

/** Keep top-level prepared so released readers relaunch the recorded build instead of downgrading.
 * Their parser drops dispatched; their completed-stop path loses activeAppVersion protection. */
export function vshudDecommissionJournal(
  transaction: VshudDecommissionTransaction
): VshudDecommissionJournal {
  const { phase, request, ...rest } = transaction
  return phase === 'prepared' || !request
    ? { ...rest, phase: 'prepared', request: null }
    : { ...rest, phase: 'prepared', request: null, dispatched: { phase, request } }
}

export function vshudDecommissionTransactionDefect(
  transaction: VshudDecommissionTransaction
): string | null {
  if (transaction.recordBefore.active !== transaction.activeVersion) {
    return 'decommission version does not match recordBefore'
  }
  if (
    serializeVshudActivationRecord(transaction.recordAfter) !==
    serializeVshudActivationRecord(withDeactivatedVersion(transaction.recordBefore))
  ) {
    return 'recordAfter is not the deactivated recordBefore'
  }
  if (transaction.request && transaction.request.version !== transaction.activeVersion) {
    return 'stop request names another version'
  }
  return null
}

export function planVshudDecommissionRecovery(
  transaction: VshudDecommissionTransaction,
  committed: boolean
): VshudDecommissionRecoveryPlan {
  if (committed) {
    return { action: 'confirm-decommissioned', version: transaction.activeVersion, record: null }
  }
  if (transaction.phase === 'process-exited') {
    return {
      action: 'confirm-decommissioned',
      version: transaction.activeVersion,
      record: committedVshudDecommissionRecord(transaction)
    }
  }
  if (transaction.phase === 'stop-dispatched' && transaction.request) {
    return {
      action: 'resume-stop',
      request: transaction.request,
      record: committedVshudDecommissionRecord(transaction)
    }
  }
  return { action: 'keep-serving', version: transaction.activeVersion }
}

/** Preserve advisory fields alongside the journaled recordAfter. */
export function committedVshudDecommissionRecord(
  transaction: VshudDecommissionTransaction
): VshudActivationRecord {
  return withDeactivatedVersionCommitted(transaction.recordBefore)
}
