// Unreadable activation records must fail closed; treating them as absent could overwrite a live install and its rollback target.
import type { VshudHostTransport } from '../install/vshud-host-transport'
import { RELAY_REMOTE_DIR } from '../install/remote-install-root'
import {
  VSHUD_ACTIVATION_FILENAME,
  emptyVshudActivationRecord,
  parseVshudActivationRecord,
  serializeVshudActivationRecord,
  type VshudActivationReadResult,
  type VshudActivationRecord
} from './vshud-activation-record'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import {
  readBoundedVshudRemoteRecord,
  writeAtomicVshudRemoteRecord
} from '../install/vshud-remote-record-file'

const VSHUD_ACTIVATION_RECORD_MAX_BYTES = 64 * 1024

type ActivationRecordTarget = {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  signal?: AbortSignal
}

export function vshudActivationPath(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, VSHUD_ACTIVATION_FILENAME)
}

async function readActivationRecordState(
  options: ActivationRecordTarget
): Promise<VshudActivationReadResult> {
  const read = await readBoundedVshudRemoteRecord(
    options,
    vshudActivationPath(options.host, options.remoteHome),
    VSHUD_ACTIVATION_RECORD_MAX_BYTES
  )
  return read.state === 'absent' ? read : parseVshudActivationRecord(read.raw)
}

export async function readVshudActivationRecord(
  options: ActivationRecordTarget
): Promise<VshudActivationRecord> {
  const parsed = await readActivationRecordState(options)
  if (parsed.state === 'ok') {
    return parsed.record
  }
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's vshud activation record: ${parsed.reason}`)
  }
  return emptyVshudActivationRecord()
}

/** Refuse replacement of unreadable records, including schemas written by newer clients. */
export async function writeVshudActivationRecord(
  options: ActivationRecordTarget,
  record: VshudActivationRecord
): Promise<void> {
  const existing = await readActivationRecordState(options)
  if (existing.state === 'unreadable') {
    throw new Error(`Refusing to overwrite this host's vshud activation record: ${existing.reason}`)
  }
  await writeAtomicVshudRemoteRecord(
    options,
    vshudActivationPath(options.host, options.remoteHome),
    serializeVshudActivationRecord(record)
  )
}
