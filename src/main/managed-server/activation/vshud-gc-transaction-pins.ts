/** Pin every journaled slot needed for recovery. An unreadable journal or unjournaled held fence hides transaction state, so GC must retain everything. */
import { vshudInstallDirNames } from './vshud-activation-record'
import type { VshudActivationTransaction } from './vshud-activation-transaction'
import { readVshudActivationTransaction } from './vshud-activation-transaction-store'
import { vshudActivationFenceExists } from './vshud-activation-lock'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import type { VshudRemoteExecTarget } from '../install/vshud-remote-runtime-control'

type VshudGcTransactionPins = { state: 'pinned'; dirNames: string[] } | { state: 'keep-all' }

function transactionVersions(transaction: VshudActivationTransaction): (string | null)[] {
  const records = [transaction.recordBefore, transaction.recordAfter]
  const fromRecords = records.flatMap((record) => (record ? [record.active, record.previous] : []))
  if (transaction.operation === 'activate') {
    return [...fromRecords, transaction.candidateVersion]
  }
  return transaction.operation === 'rollback'
    ? [...fromRecords, transaction.incumbentVersion, transaction.targetVersion]
    : fromRecords
}

export async function readVshudGcTransactionPins(
  target: VshudRemoteExecTarget & { remoteHome: string },
  /** The caller holds the activation fence, so its presence says nothing about another owner. */
  options: { callerHoldsFence?: boolean } = {}
): Promise<VshudGcTransactionPins> {
  try {
    const transaction = await readVshudActivationTransaction(target)
    if (!transaction) {
      // An unjournaled fence may be a transaction starting or an interrupted release.
      return !options.callerHoldsFence && (await vshudActivationFenceExists(target))
        ? { state: 'keep-all' }
        : { state: 'pinned', dirNames: [] }
    }
    return { state: 'pinned', dirNames: vshudInstallDirNames(transactionVersions(transaction)) }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return { state: 'keep-all' }
  }
}
