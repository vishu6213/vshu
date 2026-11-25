import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../../../shared/file-content/node-bounded-file-reader'
import {
  VSHUD_MANAGED_STOP_REQUEST_MAX_BYTES,
  VSHUD_MANAGED_STOP_REQUEST_PREFIX,
  VshudManagedStopRequestSchema,
  type VshudManagedStopContext,
  type VshudManagedStopInstance,
  type VshudManagedStopRequest
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import {
  readVshudInstanceLockRecord,
  type VshudLockRecord
} from '../../instance-lock/vshud-instance-lock-record'

/** Nonce-scoped paths prevent requests from addressing a previous instance. */
export function vshudManagedStopRequestPath(instance: VshudManagedStopInstance): string {
  const digest = createHash('sha256').update(instance.nonce).digest('hex')
  return join(dirname(instance.lockPath), `${VSHUD_MANAGED_STOP_REQUEST_PREFIX}.${digest}`)
}

export function readVshudManagedStopRequest(path: string): VshudManagedStopRequest {
  if (!lstatSync(path).isFile()) {
    throw new Error('vshud_managed_stop_request_not_regular_file')
  }
  const { buffer } = readNodeFileSyncWithinLimit(path, VSHUD_MANAGED_STOP_REQUEST_MAX_BYTES)
  return VshudManagedStopRequestSchema.parse(JSON.parse(buffer.toString('utf8')))
}

function sameVshudManagedStopInstance(
  left: VshudManagedStopInstance,
  right: Pick<VshudManagedStopInstance, 'pid' | 'startedAtMs' | 'nonce'>
): boolean {
  return (
    left.pid === right.pid && left.startedAtMs === right.startedAtMs && left.nonce === right.nonce
  )
}

export function vshudInstanceLockNames(instance: VshudManagedStopInstance): boolean {
  return readVshudInstanceLockNaming(instance) !== null
}

export function readVshudInstanceLockNaming(
  instance: VshudManagedStopInstance
): VshudLockRecord | null {
  if (!lstatSync(instance.lockPath).isFile()) {
    return null
  }
  const record = readVshudInstanceLockRecord(instance.lockPath)
  return record !== null && sameVshudManagedStopInstance(instance, record) ? record : null
}

export function validateVshudManagedStopRequest(
  context: VshudManagedStopContext,
  requestPath: string
): VshudManagedStopRequest {
  const request = readVshudManagedStopRequest(requestPath)
  if (
    request.version !== context.version ||
    request.runtimeId !== context.runtimeId ||
    // Windows clients and servers may use different separators for the same lock.
    resolve(request.instance.lockPath) !== resolve(context.instance.lockPath) ||
    !sameVshudManagedStopInstance(request.instance, context.instance)
  ) {
    throw new Error('vshud_managed_stop_request_identity_mismatch')
  }
  if (!vshudInstanceLockNames(context.instance)) {
    throw new Error('vshud_managed_stop_instance_lock_changed')
  }
  return request
}
