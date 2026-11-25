// Pre-stop census can go stale; only fenced idle-daemon retirement proves snapshot replacement safe.
import {
  readRemoteVshudManagedStopTarget,
  type VshudManagedStopTarget
} from './vshud-managed-remote-stop'
import { settleVshudDecommissionStop } from './vshud-decommission-stop'
import type { VshudSlotOptions } from '../activation/vshud-recovery-slot'
import type { VshudManagedStopContext } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'

type VshudRollbackBarrier =
  | { state: 'retired' }
  | { state: 'withdrawn'; reason: string }
  /** Stop underway or unconfirmed; retain the fence. */
  | { state: 'unsettled'; reason: string }
  /** Exit without proof of idle terminals requires restarting the incumbent. */
  | { state: 'unproven'; reason: string }

export async function readVshudRollbackBarrierTarget(
  options: VshudSlotOptions,
  version: string
): Promise<VshudManagedStopTarget> {
  const target = await readRemoteVshudManagedStopTarget(options, version)
  return target.state === 'ready'
    ? target
    : {
        ...target,
        code: 'vshud_rollback_terminal_barrier_unavailable',
        reason:
          `${target.reason} A rollback needs vshud to prove no terminal runs at its stop; ` +
          'nothing was changed.'
      }
}

export async function stopIncumbentBehindTerminalBarrier(
  options: VshudSlotOptions,
  transactionId: string,
  context: VshudManagedStopContext
): Promise<VshudRollbackBarrier> {
  const settlement = await settleVshudDecommissionStop(options, {
    schemaVersion: 1,
    transactionId,
    ...context,
    retireIdleDaemon: true
  })
  if (settlement.state === 'withdrawn' || settlement.state === 'unsettled') {
    return { state: settlement.state, reason: settlement.reason }
  }
  if (settlement.retirement === 'retired') {
    return { state: 'retired' }
  }
  return {
    state: 'unproven',
    reason:
      `vshud ${context.version} stopped, but its terminal daemon reported ` +
      `${settlement.retirement} work at the stop, so the older snapshot was not restored.`
  }
}

type VshudRollbackBarrierRefusal = {
  outcome: 'refused' | 'failed'
  code: string
  reason: string
  retainFence: boolean
  restartIncumbent: boolean
}

/** Only retired daemons permit replacing current state with an older snapshot. */
export function rollbackBarrierRefusal(
  barrier: VshudRollbackBarrier
): VshudRollbackBarrierRefusal | null {
  switch (barrier.state) {
    case 'retired':
      return null
    case 'withdrawn':
      return {
        outcome: 'failed',
        code: 'vshud_rollback_stop_withdrawn',
        reason: barrier.reason,
        retainFence: false,
        restartIncumbent: false
      }
    case 'unsettled':
      return {
        outcome: 'failed',
        code: 'vshud_rollback_stop_incomplete',
        reason: `${barrier.reason} Nothing was restored.`,
        retainFence: true,
        restartIncumbent: false
      }
    case 'unproven':
      return {
        outcome: 'refused',
        code: 'vshud_rollback_terminals_at_stop',
        reason: barrier.reason,
        retainFence: false,
        restartIncumbent: true
      }
  }
}
