// Exclusive hard links arbitrate stop versus cancel; cancel cannot succeed once dispatch wins.
import { linkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../../../shared/secure-storage/secure-file'
import {
  VshudManagedStopDecisionSchema,
  VshudManagedStopRequestSchema,
  type VshudManagedStopDecision,
  type VshudManagedStopRequest
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { vshudStopReceiptPath, readVshudStopReceipt } from './vshud-completed-stop-receipt'
import { hasErrorCode } from '../../../daemon/endpoint/identity/daemon-process-inspection'

type VshudManagedStopDecisionValue = VshudManagedStopDecision['decision']

export function readVshudManagedStopDecision(
  request: VshudManagedStopRequest
): VshudManagedStopDecisionValue | null {
  return readVshudStopReceipt(request, 'decision', VshudManagedStopDecisionSchema)?.decision ?? null
}

export function claimVshudManagedStopDecision(
  input: VshudManagedStopRequest,
  decision: VshudManagedStopDecisionValue
): VshudManagedStopDecisionValue {
  const request = VshudManagedStopRequestSchema.parse(input)
  const path = vshudStopReceiptPath(request, 'decision')
  const staged = `${path}.${process.pid}.${randomUUID()}.staged`
  const record: VshudManagedStopDecision = {
    schemaVersion: 1,
    kind: 'vshud_managed_stop_decision',
    request,
    decision
  }
  if (!writeDurableSecureJsonFile(staged, record)) {
    rmSync(staged, { force: true })
    throw new Error('vshud_managed_stop_decision_permissions_unconfirmed')
  }
  try {
    linkSync(staged, path)
    return decision
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw error
    }
    const standing = readVshudManagedStopDecision(request)
    if (!standing) {
      throw new Error('vshud_managed_stop_decision_unverifiable')
    }
    return standing
  } finally {
    rmSync(staged, { force: true })
  }
}
