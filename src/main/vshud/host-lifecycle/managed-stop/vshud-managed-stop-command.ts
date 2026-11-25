// Exit 0 means JSON was printed; read its outcome. Exit 64 is invalid input, 1 is failure without exit proof.
import {
  VSHUD_CANCEL_MANAGED_STOP_FLAG,
  VSHUD_COMPLETE_MANAGED_STOP_FLAG,
  VSHUD_MANAGED_STOP_REQUEST_FILE_FLAG,
  VshudManagedStopRequestSchema,
  type VshudManagedStopCancellation,
  type VshudManagedStopCompletion,
  type VshudManagedStopRequest
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { cancelVshudManagedStop } from './vshud-managed-stop-cancellation'
import { readVshudCompletedStopReceipt } from './vshud-completed-stop-receipt'
import { readVshudManagedStopRequest } from './vshud-managed-stop-request'
import { ZodError } from 'zod'
import {
  completeVshudManagedStop,
  type VshudManagedStopCompletionOptions
} from './vshud-managed-stop-completion'

export async function runVshudManagedStopCommand(
  argv: readonly string[],
  options: VshudManagedStopCompletionOptions = {}
): Promise<VshudManagedStopCompletion> {
  const request = parseRequestArgument(argv, VSHUD_COMPLETE_MANAGED_STOP_FLAG)
  const verdict = await completeVshudManagedStop(request, options)
  const retirement =
    verdict === 'exited' && request.retireIdleDaemon
      ? readVshudCompletedStopReceipt(request)?.retirement
      : undefined
  const completion: VshudManagedStopCompletion = {
    ...request,
    kind: 'vshud_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited',
    ...(retirement ? { retirement } : {})
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export function runVshudManagedStopCancelCommand(
  argv: readonly string[]
): VshudManagedStopCancellation {
  const request = parseRequestArgument(argv, VSHUD_CANCEL_MANAGED_STOP_FLAG)
  const cancellation: VshudManagedStopCancellation = {
    ...request,
    kind: 'vshud_managed_stop_cancellation',
    outcome: cancelVshudManagedStop(request)
  }
  process.stdout.write(`${JSON.stringify(cancellation)}\n`)
  return cancellation
}

function parseRequestArgument(argv: readonly string[], flag: string): VshudManagedStopRequest {
  if (argv[0] !== flag) {
    throw new Error('vshud_managed_stop_invalid_arguments')
  }
  if (argv[1] === VSHUD_MANAGED_STOP_REQUEST_FILE_FLAG) {
    if (argv.length !== 3 || !argv[2]) {
      throw new Error('vshud_managed_stop_invalid_arguments')
    }
    return readVshudManagedStopRequest(argv[2])
  }
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('vshud_managed_stop_invalid_arguments')
  }
  return VshudManagedStopRequestSchema.parse(JSON.parse(argv[1]))
}

export const VSHUD_MANAGED_STOP_EXIT_VERDICT = 0
export const VSHUD_MANAGED_STOP_EXIT_FAILED = 1
export const VSHUD_MANAGED_STOP_EXIT_USAGE = 64

export async function runVshudManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = VSHUD_MANAGED_STOP_EXIT_VERDICT
  try {
    if (argv[0] === VSHUD_CANCEL_MANAGED_STOP_FLAG) {
      runVshudManagedStopCancelCommand(argv)
    } else {
      await runVshudManagedStopCommand(argv)
    }
  } catch (error) {
    console.error('vshud: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'vshud_managed_stop_invalid_arguments')
        ? VSHUD_MANAGED_STOP_EXIT_USAGE
        : VSHUD_MANAGED_STOP_EXIT_FAILED
  }
  // Drain stdout before exit: callers read the result to EOF.
  process.stdout.write('', () => process.exit(code))
}
