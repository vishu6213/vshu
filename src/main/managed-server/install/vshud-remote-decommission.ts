// Journal instance-bound stop under the activation fence; refuse live/unknown terminal census and deactivate only after proven exit.
import { randomUUID } from 'node:crypto'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'
import {
  readVshudActivationRecord,
  writeVshudActivationRecord
} from '../activation/vshud-activation-record-store'
import { sameVshudActivationRecord } from '../activation/vshud-activation-transaction'
import { writeVshudActivationTransaction } from '../activation/vshud-activation-transaction-store'
import { withVshudActivationLock } from '../activation/vshud-activation-lock'
import { vshudActivationFenceRefusal } from '../activation/vshud-activation-fence-hold'
import {
  committedVshudDecommissionRecord,
  createVshudDecommissionTransaction,
  withVshudDecommissionProcessExited,
  withVshudDecommissionStopDispatched
} from '../lifecycle/vshud-decommission-transaction'
import { readRemoteVshudManagedStopTarget } from '../lifecycle/vshud-managed-remote-stop'
import { settleVshudDecommissionStop } from '../lifecycle/vshud-decommission-stop'
import type { VshudSlotOptions } from '../activation/vshud-recovery-slot'
import type { VshudDecommissionResult } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-decommission'
import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'

type VshudDecommissionOptions = VshudSlotOptions & {
  /** Refuse if the host record changed since caller review. */
  record: VshudActivationRecord
  /** Fresh census must prove no live or uncounted terminals. */
  census: VshudTerminalCensus
  now?: () => Date
}

type Refusal = Extract<VshudDecommissionResult, { outcome: 'refused' }>

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

function censusRefusal(census: VshudTerminalCensus): Refusal | null {
  if (census.liveSessions === null) {
    return refuse(
      'unverifiable',
      'vshud_decommission_census_unavailable',
      'The terminal daemon did not answer a session count, so decommissioning could end ' +
        'running work. Retry when the host answers.'
    )
  }
  if (census.liveSessions > 0) {
    return refuse(
      'live',
      'vshud_decommission_terminals_running',
      `${census.liveSessions} terminal${census.liveSessions === 1 ? ' is' : 's are'} still ` +
        'running on this host. Close them before decommissioning the server.'
    )
  }
  return null
}

export async function decommissionRemoteVshud(
  options: VshudDecommissionOptions
): Promise<VshudDecommissionResult> {
  const now = options.now ?? ((): Date => new Date())
  return withVshudActivationLock(
    options,
    async (lock) => {
      const record = await readVshudActivationRecord(options)
      if (!sameVshudActivationRecord(record, options.record)) {
        return refuse(
          'unverifiable',
          'vshud_decommission_record_changed',
          'The host activation record changed since it was reviewed. Refresh and try again.'
        )
      }
      const activeVersion = record.active
      if (!activeVersion) {
        return refuse(
          'unverifiable',
          'vshud_decommission_nothing_active',
          'No vshud version is active on this host, so there is nothing to decommission.'
        )
      }
      const census = censusRefusal(options.census)
      if (census) {
        return census
      }
      const target = await readRemoteVshudManagedStopTarget(options, activeVersion)
      if (target.state === 'refused') {
        return refuse(target.verdict, target.code, target.reason)
      }

      let transaction = createVshudDecommissionTransaction({
        transactionId: randomUUID(),
        recordBefore: { ...record, active: activeVersion },
        now: now()
      })
      await writeVshudActivationTransaction(options, transaction)
      lock.retainOnError()
      const request = {
        schemaVersion: 1 as const,
        transactionId: transaction.transactionId,
        ...target.context,
        // Idle daemon retirement is best-effort; busy daemons retain their terminals.
        retireIdleDaemon: true as const
      }
      // Journal exact stop intent before dispatch so recovery can settle the same request.
      transaction = withVshudDecommissionStopDispatched(transaction, request, now())
      await writeVshudActivationTransaction(options, transaction)

      const settlement = await settleVshudDecommissionStop(options, request)
      if (settlement.state === 'withdrawn') {
        return refuse(settlement.verdict, 'vshud_decommission_stop_withdrawn', settlement.reason)
      }
      if (settlement.state === 'unsettled') {
        lock.retain()
        return refuse(settlement.verdict, 'vshud_decommission_stop_unsettled', settlement.reason)
      }
      transaction = withVshudDecommissionProcessExited(transaction, now())
      await writeVshudActivationTransaction(options, transaction)
      await writeVshudActivationRecord(options, committedVshudDecommissionRecord(transaction))
      return {
        outcome: 'decommissioned',
        version: activeVersion,
        retirement: settlement.retirement
      }
    },
    async () => {
      const refusal = await vshudActivationFenceRefusal(options, 'stop')
      return refuse('unverifiable', refusal.code, refusal.reason)
    }
  )
}
