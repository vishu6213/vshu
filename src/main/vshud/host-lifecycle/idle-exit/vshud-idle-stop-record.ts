// Consume clean idle-stop evidence once; discard failed stops so later crashes cannot inherit it.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../../../shared/file-content/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../../../shared/secure-storage/secure-file'
import {
  VSHUD_IDLE_STOP_RECORD_FILENAME,
  VshudIdleStopRecordSchema,
  type VshudIdleStopRecord
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-idle-exit'
import type { VshudIdleExitEvidence } from './vshud-idle-exit-monitor'
import { hasErrorCode } from '../../../daemon/endpoint/identity/daemon-process-inspection'

const RECORD_MAX_BYTES = 16 * 1024

export function vshudIdleStopRecordPath(userDataPath: string): string {
  return join(userDataPath, VSHUD_IDLE_STOP_RECORD_FILENAME)
}

export function writeVshudIdleStopRecord(
  userDataPath: string,
  evidence: VshudIdleExitEvidence,
  version: string
): void {
  const record: VshudIdleStopRecord = {
    schemaVersion: 1,
    kind: 'vshud_idle_stop',
    pid: process.pid,
    version,
    quietSince: new Date(evidence.quietSince).toISOString(),
    stoppedAt: new Date(evidence.stoppedAt).toISOString(),
    idleTimeoutMs: evidence.timeoutMs
  }
  if (!writeDurableSecureJsonFile(vshudIdleStopRecordPath(userDataPath), record)) {
    throw new Error('vshud_idle_stop_record_permissions_unconfirmed')
  }
}

export function consumeVshudIdleStopRecord(userDataPath: string): VshudIdleStopRecord | null {
  const path = vshudIdleStopRecordPath(userDataPath)
  let record: VshudIdleStopRecord | null = null
  try {
    const raw = readNodeFileSyncWithinLimit(path, RECORD_MAX_BYTES).buffer.toString('utf8')
    record = VshudIdleStopRecordSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    console.error('[vshud] ignoring an unreadable idle-stop record:', error)
  }
  rmSync(path, { force: true })
  return record
}

export function discardVshudIdleStopRecord(userDataPath: string): void {
  rmSync(vshudIdleStopRecordPath(userDataPath), { force: true })
}
