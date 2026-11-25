/** Stop files reach only the watching vshud; signals from stale PID records could stop an unrelated reused process. */
import { z } from 'zod'
import { openEnum } from '../../validation/zod-salvage'

/** Plain request in the slot directory: the same graceful stop as SIGTERM. */
export const VSHUD_STOP_REQUEST_FILENAME = '.vshud-stop-request'
/** Prefix of an instance-bound request in the data root; older listeners never match it. */
export const VSHUD_MANAGED_STOP_REQUEST_PREFIX = '.vshud-managed-stop-request'
export const VSHUD_MANAGED_STOP_REQUEST_MAX_BYTES = 32 * 1024
export const VSHUD_STOP_RECEIPTS_DIRNAME = 'vshud-stop-receipts'
export const VSHUD_COMPLETE_MANAGED_STOP_FLAG = '--complete-managed-stop'
/** Names a staged request file instead of inline JSON; Windows hosts never put the JSON on argv. */
export const VSHUD_MANAGED_STOP_REQUEST_FILE_FLAG = '--request-file'

/** One vshud process: its PID, start time, and the instance lock record it published. */
export const VshudManagedStopInstanceSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Linux only, copied from the lock; older clients omit it and older slots drop it. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  nonce: z.string().min(1).max(255),
  lockPath: z.string().min(1).max(4096)
})

// Older slots drop newer optional request fields rather than refuse the stop.
export const VshudManagedStopRequestSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.uuid(),
  version: z.string().min(1).max(255),
  runtimeId: z.string().min(1).max(255),
  instance: VshudManagedStopInstanceSchema,
  /** Best effort: also retire the terminal daemon if it is provably idle. Never blocks the stop. */
  retireIdleDaemon: z.literal(true).optional()
})

export type VshudManagedStopInstance = z.infer<typeof VshudManagedStopInstanceSchema>
export type VshudManagedStopRequest = z.infer<typeof VshudManagedStopRequestSchema>

/** Equality key for a request; omits the incarnation, which an older client recovering it drops. */
export function vshudManagedStopRequestKey(request: VshudManagedStopRequest): string {
  const { instance, ...rest } = VshudManagedStopRequestSchema.parse(request)
  const { linuxStartTicks: _ticks, bootId: _bootId, ...bound } = instance
  return JSON.stringify({ ...rest, instance: bound })
}
/** What a stopping vshud must match before a managed request may stop it. */
export type VshudManagedStopContext = Omit<
  VshudManagedStopRequest,
  'schemaVersion' | 'transactionId'
>

const STOP_VERDICTS = ['live', 'unverifiable', 'exited'] as const
const RETIREMENT_VERDICTS = ['retired', 'live', 'unverifiable'] as const

/** The execution host's verdict; `exited` only on proof, never on silence. */
export const VshudManagedStopVerdictSchema = z.enum(STOP_VERDICTS)

/** `retired` only when the daemon accepted; a busy daemon stays up and keeps its terminals. */
export const VshudDaemonRetirementVerdictSchema = z.enum(RETIREMENT_VERDICTS)

// Read by clients older than the slot that printed them: unknown fields and arms degrade.
const stopReplyRequestFields = VshudManagedStopRequestSchema.shape

export const VshudManagedStopCompletionSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('vshud_managed_stop_completion'),
  verdict: openEnum(STOP_VERDICTS, 'unverifiable'),
  receiptPersisted: z.boolean(),
  /** For a request that asked to retire the daemon, the outcome its receipt recorded. */
  retirement: openEnum(RETIREMENT_VERDICTS, 'unverifiable').optional()
})

/** What the stopping vshud observed about its daemon, written before it exits. */
export const VshudDaemonRetirementRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('vshud_managed_stop_retirement'),
  request: VshudManagedStopRequestSchema,
  retirement: VshudDaemonRetirementVerdictSchema,
  liveSessions: z.number().int().nonnegative().nullable(),
  reason: z.string().max(4096).nullable()
})

export const VshudCompletedStopReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('vshud_managed_stop_completed'),
  request: VshudManagedStopRequestSchema,
  exitedAt: z.iso.datetime({ offset: true }),
  /** Present only when the request asked to retire the daemon. */
  retirement: VshudDaemonRetirementVerdictSchema.optional()
})

export type VshudManagedStopVerdict = z.infer<typeof VshudManagedStopVerdictSchema>
export type VshudManagedStopCompletion = z.infer<typeof VshudManagedStopCompletionSchema>
export type VshudCompletedStopReceipt = z.infer<typeof VshudCompletedStopReceiptSchema>
export type VshudDaemonRetirementVerdict = z.infer<typeof VshudDaemonRetirementVerdictSchema>
export type VshudDaemonRetirementRecord = z.infer<typeof VshudDaemonRetirementRecordSchema>

export const VSHUD_CANCEL_MANAGED_STOP_FLAG = '--cancel-managed-stop'
/** Readiness `health.stopRequests`: this build consumes stop files and both commands above. */
export const VSHUD_STOP_REQUESTS_CAPABILITY = 1

/** Exclusive per-transaction creation ensures only vshud dispatch or client cancellation can win. */
export const VshudManagedStopDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('vshud_managed_stop_decision'),
  request: VshudManagedStopRequestSchema,
  decision: z.enum(['dispatched', 'canceled'])
})

/** `dispatched` means vshud already acted on the request; the caller must await its exit. */
export const VshudManagedStopCancellationSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('vshud_managed_stop_cancellation'),
  // Unknown degrades to `dispatched`: the caller then awaits exit rather than assume a cancel.
  outcome: openEnum(['canceled', 'dispatched'], 'dispatched')
})

export type VshudManagedStopDecision = z.infer<typeof VshudManagedStopDecisionSchema>
export type VshudManagedStopCancellation = z.infer<typeof VshudManagedStopCancellationSchema>
