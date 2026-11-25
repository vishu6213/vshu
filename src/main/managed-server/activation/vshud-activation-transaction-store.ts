import {
  vshudActivationTransactionPath,
  parseVshudActivationTransaction,
  serializeVshudActivationTransaction,
  type VshudActivationTransaction
} from './vshud-activation-transaction'
import {
  readBoundedVshudRemoteRecord,
  writeAtomicVshudRemoteRecord
} from '../install/vshud-remote-record-file'
import type { VshudRemoteExecTarget } from '../install/vshud-remote-runtime-control'
import { currentVshudFence } from './vshud-activation-fence-scope'

const VSHUD_ACTIVATION_TRANSACTION_MAX_BYTES = 64 * 1024

type VshudActivationTransactionStoreOptions = VshudRemoteExecTarget & { remoteHome: string }

/** Only verified absence returns null; unreadable journals retain the fence. */
export async function readVshudActivationTransaction(
  options: VshudActivationTransactionStoreOptions
): Promise<VshudActivationTransaction | null> {
  const read = await readBoundedVshudRemoteRecord(
    options,
    vshudActivationTransactionPath(options.host, options.remoteHome),
    VSHUD_ACTIVATION_TRANSACTION_MAX_BYTES
  )
  const parsed = parseVshudActivationTransaction(read.state === 'present' ? read.raw : null)
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's vshud activation transaction: ${parsed.reason}`)
  }
  return parsed.state === 'ok' ? parsed.transaction : null
}

/** Stamp each write with its fence generation so release cannot delete another holder's journal. */
export function writeVshudActivationTransaction(
  options: VshudActivationTransactionStoreOptions,
  transaction: VshudActivationTransaction
): Promise<void> {
  const fenceToken = currentVshudFence()?.token
  return writeAtomicVshudRemoteRecord(
    options,
    vshudActivationTransactionPath(options.host, options.remoteHome),
    serializeVshudActivationTransaction(fenceToken ? { ...transaction, fenceToken } : transaction)
  )
}
