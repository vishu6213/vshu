import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../../../shared/file-content/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../../../shared/secure-storage/secure-file'
import { hasErrorCode } from '../../../daemon/endpoint/identity/daemon-process-inspection'
import {
  VSHUD_STOP_RECEIPTS_DIRNAME,
  VshudCompletedStopReceiptSchema,
  VshudManagedStopRequestSchema,
  VshudDaemonRetirementRecordSchema,
  vshudManagedStopRequestKey,
  type VshudCompletedStopReceipt,
  type VshudDaemonRetirementRecord,
  type VshudManagedStopRequest
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'

const RECEIPT_MAX_BYTES = 64 * 1024

type ReceiptKind = 'completed' | 'retirement' | 'decision'

export function vshudStopReceiptPath(request: VshudManagedStopRequest, kind: ReceiptKind): string {
  const { transactionId, instance } = VshudManagedStopRequestSchema.parse(request)
  const suffix = kind === 'completed' ? '' : `.${kind}`
  return join(
    dirname(instance.lockPath),
    VSHUD_STOP_RECEIPTS_DIRNAME,
    `${transactionId}${suffix}.json`
  )
}

/** Absent returns null; mismatched request receipts throw. */
export function readVshudStopReceipt<T extends { request: VshudManagedStopRequest }>(
  request: VshudManagedStopRequest,
  kind: ReceiptKind,
  schema: z.ZodType<T>
): T | null {
  const path = vshudStopReceiptPath(request, kind)
  try {
    if (!lstatSync(path).isFile()) {
      throw new Error('vshud_stop_receipt_unverifiable')
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  const receipt = schema.parse(
    JSON.parse(readNodeFileSyncWithinLimit(path, RECEIPT_MAX_BYTES).buffer.toString('utf8'))
  )
  if (vshudManagedStopRequestKey(receipt.request) !== vshudManagedStopRequestKey(request)) {
    throw new Error('vshud_stop_receipt_mismatch')
  }
  return receipt
}

function writeReceipt(request: VshudManagedStopRequest, kind: ReceiptKind, receipt: unknown): void {
  if (!writeDurableSecureJsonFile(vshudStopReceiptPath(request, kind), receipt)) {
    throw new Error('vshud_stop_receipt_permissions_unconfirmed')
  }
}

export function readVshudCompletedStopReceipt(
  request: VshudManagedStopRequest
): VshudCompletedStopReceipt | null {
  return readVshudStopReceipt(request, 'completed', VshudCompletedStopReceiptSchema)
}

/** Persist only after proven exit and fsync even existing receipts.
 * Missing retirement records remain unverifiable. */
export function persistVshudCompletedStopReceipt(
  request: VshudManagedStopRequest,
  exitedAt: Date
): VshudCompletedStopReceipt {
  const parsed = VshudManagedStopRequestSchema.parse(request)
  const retirement = parsed.retireIdleDaemon
    ? (readVshudDaemonRetirementRecord(parsed)?.retirement ?? 'unverifiable')
    : undefined
  const receipt = readVshudCompletedStopReceipt(parsed) ?? {
    schemaVersion: 1 as const,
    kind: 'vshud_managed_stop_completed' as const,
    request: parsed,
    exitedAt: exitedAt.toISOString(),
    ...(retirement ? { retirement } : {})
  }
  writeReceipt(parsed, 'completed', receipt)
  return receipt
}

export function readVshudDaemonRetirementRecord(
  request: VshudManagedStopRequest
): VshudDaemonRetirementRecord | null {
  return readVshudStopReceipt(request, 'retirement', VshudDaemonRetirementRecordSchema)
}

export function persistVshudDaemonRetirementRecord(
  request: VshudManagedStopRequest,
  outcome: Pick<VshudDaemonRetirementRecord, 'retirement' | 'liveSessions' | 'reason'>
): void {
  writeReceipt(request, 'retirement', {
    schemaVersion: 1,
    kind: 'vshud_managed_stop_retirement',
    request: VshudManagedStopRequestSchema.parse(request),
    // Name fields explicitly; extra in-process fields would fail the strict schema.
    retirement: outcome.retirement,
    liveSessions: outcome.liveSessions,
    reason: outcome.reason
  })
}
