// Request shutdown without signaling; only kernel identity, owner change or PID absence proves exit.
import { setTimeout as delay } from 'node:timers/promises'
import { writeDurableSecureJsonFile } from '../../../../shared/secure-storage/secure-file'
import {
  VshudManagedStopRequestSchema,
  vshudManagedStopRequestKey,
  type VshudManagedStopInstance,
  type VshudManagedStopRequest,
  type VshudManagedStopVerdict
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import {
  compareVshudProcessIdentity,
  recordedVshudProcessIncarnation,
  type VshudProcessIdentityReaders,
  type VshudRecordedIdentity
} from '../../instance-lock/vshud-process-start-time'
import {
  hasErrorCode,
  inspectProcessSignal
} from '../../../daemon/endpoint/identity/daemon-process-inspection'
import { persistVshudCompletedStopReceipt } from './vshud-completed-stop-receipt'
import { readVshudManagedStopDecision } from './vshud-managed-stop-decision'
import { withdrawVshudManagedStopRequest } from './vshud-managed-stop-cancellation'
import {
  vshudInstanceLockNames,
  vshudManagedStopRequestPath,
  readVshudInstanceLockNaming,
  readVshudManagedStopRequest
} from './vshud-managed-stop-request'
import {
  VSHUD_STOP_COMPLETION_POLL_ATTEMPTS,
  VSHUD_STOP_COMPLETION_POLL_MS
} from './vshud-stop-deadlines'

type VshudProcessProbe = (pid: number) => 'alive' | 'missing' | 'unverifiable'

export type VshudManagedStopCompletionOptions = VshudProcessIdentityReaders & {
  probeProcess?: VshudProcessProbe
  sleep?: () => Promise<void>
  attempts?: number
  now?: () => Date
}

function defaultProbe(pid: number): ReturnType<VshudProcessProbe> {
  const signal = inspectProcessSignal(pid)
  // EPERM proves some process holds the PID; it cannot prove ours exited.
  return signal === 'occupied' ? 'alive' : signal === 'missing' ? 'missing' : 'unverifiable'
}

function observeInstance(
  instance: VshudManagedStopInstance,
  recorded: VshudRecordedIdentity,
  options: VshudManagedStopCompletionOptions
): VshudManagedStopVerdict {
  const probe = (options.probeProcess ?? defaultProbe)(instance.pid)
  if (probe !== 'alive') {
    return probe === 'missing' ? 'exited' : 'unverifiable'
  }
  // Wall-clock drift alone cannot prove PID reuse.
  const identity = compareVshudProcessIdentity(instance.pid, recorded, options)
  return identity === 'differs' ? 'exited' : identity === 'unproven' ? 'unverifiable' : 'live'
}

/** Recover incarnation data from the lock for older clients that omit it. */
function recordedIdentity(instance: VshudManagedStopInstance): VshudRecordedIdentity {
  if (recordedVshudProcessIncarnation(instance)) {
    return instance
  }
  let record: VshudRecordedIdentity | null = null
  try {
    record = readVshudInstanceLockNaming(instance)
  } catch {
    return instance
  }
  if (!record) {
    return instance
  }
  return { ...instance, ...recordedVshudProcessIncarnation(record), identity: record.identity }
}

export async function completeVshudManagedStop(
  input: VshudManagedStopRequest,
  options: VshudManagedStopCompletionOptions = {}
): Promise<VshudManagedStopVerdict> {
  const request = VshudManagedStopRequestSchema.parse(input)
  const attempts = options.attempts ?? VSHUD_STOP_COMPLETION_POLL_ATTEMPTS
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error('vshud_managed_stop_invalid_attempts')
  }
  const completed = (): 'exited' => {
    persistVshudCompletedStopReceipt(request, (options.now ?? (() => new Date()))())
    return 'exited'
  }
  const recorded = recordedIdentity(request.instance)
  let verdict = observeInstance(request.instance, recorded, options)
  if (verdict !== 'live') {
    return verdict === 'exited' ? completed() : verdict
  }
  if (!lockStillNamesInstance(request.instance)) {
    // A live process that relinquished its lock is no longer ours to address.
    return 'unverifiable'
  }
  if (readVshudManagedStopDecision(request) === 'canceled') {
    return 'live'
  }
  const requestPath = vshudManagedStopRequestPath(request.instance)
  if (!existingRequestMatches(requestPath, request)) {
    return 'unverifiable'
  }
  if (!writeDurableSecureJsonFile(requestPath, request)) {
    throw new Error('vshud_managed_stop_request_permissions_unconfirmed')
  }
  // A cancel between the first check and write had no request file to remove.
  if (readVshudManagedStopDecision(request) === 'canceled') {
    withdrawVshudManagedStopRequest(request)
    return 'live'
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    await (options.sleep ?? (() => delay(VSHUD_STOP_COMPLETION_POLL_MS)))()
    verdict = observeInstance(request.instance, recorded, options)
    if (verdict !== 'live') {
      return verdict === 'exited' ? completed() : verdict
    }
  }
  return 'live'
}

function lockStillNamesInstance(instance: VshudManagedStopInstance): boolean {
  try {
    return vshudInstanceLockNames(instance)
  } catch {
    return false
  }
}

function existingRequestMatches(path: string, request: VshudManagedStopRequest): boolean {
  try {
    return (
      vshudManagedStopRequestKey(readVshudManagedStopRequest(path)) ===
      vshudManagedStopRequestKey(request)
    )
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}
