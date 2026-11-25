import { rmSync } from 'node:fs'
import type {
  VshudManagedStopCancellation,
  VshudManagedStopRequest
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { claimVshudManagedStopDecision } from './vshud-managed-stop-decision'
import {
  vshudManagedStopRequestPath,
  readVshudManagedStopRequest
} from './vshud-managed-stop-request'

/** Dispatched stops cannot be canceled; their completion verdict remains authoritative. */
export function cancelVshudManagedStop(
  request: VshudManagedStopRequest
): VshudManagedStopCancellation['outcome'] {
  const outcome = claimVshudManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawVshudManagedStopRequest(request)
  }
  return outcome
}

export function withdrawVshudManagedStopRequest(request: VshudManagedStopRequest): void {
  const path = vshudManagedStopRequestPath(request.instance)
  try {
    if (readVshudManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // The persisted decision fences this transaction even if its request is gone.
  }
}
