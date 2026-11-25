import type { VshudActivationRecord } from './vshud-activation-record'
import { VSHUD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from './vshud-activation-transaction-schema'
import type {
  VshudActivateTransaction,
  VshudRollbackTransaction
} from './vshud-activation-transaction'

export function createVshudActivationTransaction(options: {
  transactionId: string
  candidateVersion: string
  appVersion?: string
  recordBefore: VshudActivationRecord
  snapshotDirName: string
  now: Date
}): VshudActivateTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: VSHUD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'activate',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    candidateVersion: options.candidateVersion,
    candidateAppVersion: options.appVersion ?? null,
    recordBefore: options.recordBefore,
    recordAfter: null,
    snapshot: { dirName: options.snapshotDirName, state: 'pending' }
  }
}

export function withVshudActivationIncumbentStopped(
  transaction: VshudActivateTransaction,
  now: Date
): VshudActivateTransaction {
  return {
    ...transaction,
    phase: 'incumbent-stopped',
    updatedAt: now.toISOString()
  }
}

export function withVshudActivationSnapshot(
  transaction: VshudActivateTransaction,
  state: 'captured' | 'empty',
  now: Date
): VshudActivateTransaction {
  return {
    ...transaction,
    phase: 'snapshot-captured',
    updatedAt: now.toISOString(),
    snapshot: { dirName: transaction.snapshot.dirName, state }
  }
}

export function withVshudActivationCandidateReady(
  transaction: VshudActivateTransaction,
  recordAfter: VshudActivationRecord,
  now: Date
): VshudActivateTransaction {
  return {
    ...transaction,
    phase: 'candidate-ready',
    updatedAt: now.toISOString(),
    recordAfter
  }
}

export function createVshudRollbackTransaction(options: {
  transactionId: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: VshudActivationRecord
  recordAfter: VshudActivationRecord
  rescueDirName: string
  now: Date
}): VshudRollbackTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: VSHUD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'rollback',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    incumbentVersion: options.incumbentVersion,
    targetVersion: options.targetVersion,
    recordBefore: options.recordBefore,
    recordAfter: options.recordAfter,
    rescue: { dirName: options.rescueDirName, state: 'pending' }
  }
}

export function withVshudRollbackPhase(
  transaction: VshudRollbackTransaction,
  phase: 'incumbent-stopped' | 'rollback-state-restored' | 'target-ready',
  now: Date
): VshudRollbackTransaction {
  return { ...transaction, phase, updatedAt: now.toISOString() }
}

export function withVshudRollbackRescue(
  transaction: VshudRollbackTransaction,
  state: 'captured' | 'empty',
  now: Date
): VshudRollbackTransaction {
  return {
    ...transaction,
    phase: 'rescue-captured',
    updatedAt: now.toISOString(),
    rescue: { dirName: transaction.rescue.dirName, state }
  }
}
