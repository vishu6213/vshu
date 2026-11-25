/**
 * The stop half of restarting an idle vshud in place: under the host lock, recount with terminal
 * admission closed, and stop only at zero terminals, retiring the idle daemon with it. The caller
 * wakes the slot again over its own transport (an SSH restart, or a WSL host relaunch).
 */
import { randomUUID } from 'node:crypto'
import {
  withVshudActivationLock,
  type VshudActivationLockControl
} from '../activation/vshud-activation-lock'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { runFencedStop, type updateTerminalCounts } from '../activation/vshud-fenced-stop'
import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { VshudSlotOptions } from '../activation/vshud-recovery-slot'
import { readRemoteVshudManagedStopTarget } from './vshud-managed-remote-stop'
import { stopIncumbentBehindTerminalBarrier } from './vshud-rollback-terminal-barrier'

export type VshudIdleRestartStop =
  | { state: 'retired'; version: string }
  /** The surviving daemon still spawns terminals with old attribution. */
  | { state: 'daemon-kept'; version: string; reason: string }
  /** Serving or possibly stopping; do not start another instance. */
  | { state: 'kept'; reason: string; mayBeStopping?: true }
  | { state: 'terminals-running'; liveSessions: number | null }

type RestartCounts = Pick<
  ReturnType<typeof updateTerminalCounts>,
  'recountCensus' | 'releaseIncumbentAdmission'
> & {
  /** Other live work on the fenced recount that keeps the server serving, as the kept reason. */
  refuseOtherWork?: (census: VshudTerminalCensus) => string | null
}

/** Stops the active vshud only if a fenced recount proves zero terminals. */
export async function stopIdleVshudForRestart(
  slot: VshudSlotOptions,
  counts: RestartCounts
): Promise<VshudIdleRestartStop> {
  return await withVshudActivationLock(
    slot,
    (lock) => recountThenStop(slot, lock, counts),
    (): VshudIdleRestartStop => ({
      state: 'kept',
      reason: 'An update, rollback or recovery holds this host; try again when it finishes.'
    })
  )
}

/** Only the host lock holder may close/reopen admission, preserving other runs' fences. */
async function recountThenStop(
  slot: VshudSlotOptions,
  lock: VshudActivationLockControl,
  counts: RestartCounts
): Promise<VshudIdleRestartStop> {
  const fenced = await runFencedStop({
    ...counts,
    now: Date.now,
    refuse: (census): VshudIdleRestartStop | null => {
      if (census.liveSessions !== 0) {
        return { state: 'terminals-running', liveSessions: census.liveSessions }
      }
      const otherWork = counts.refuseOtherWork?.(census) ?? null
      return otherWork === null ? null : { state: 'kept', reason: otherWork }
    },
    stale: (): VshudIdleRestartStop => STALE_COUNT,
    stop: (stillFenced) => stopRetiringIdleDaemon(slot, lock, stillFenced),
    // Woken servers start with admission open; only unsent stops need reopening.
    stopMayHaveBeenSent: (outcome) =>
      outcome.state === 'retired' ||
      outcome.state === 'daemon-kept' ||
      (outcome.state === 'kept' && outcome.mayBeStopping === true)
  })
  return 'refused' in fenced ? fenced.refused : fenced.stopped
}

const STALE_COUNT: VshudIdleRestartStop = {
  state: 'kept',
  reason: 'The terminal count went stale before the stop. Restart again.'
}

async function stopRetiringIdleDaemon(
  slot: VshudSlotOptions,
  lock: VshudActivationLockControl,
  stillFenced: () => boolean
): Promise<VshudIdleRestartStop> {
  // Other clients may change the active slot; reread under the fence.
  const active = (await readVshudActivationRecord(slot)).active
  if (!active) {
    return { state: 'kept', reason: 'This host has no activated Vshu server.' }
  }
  const target = await readRemoteVshudManagedStopTarget(slot, active)
  if (target.state === 'refused') {
    return { state: 'kept', reason: target.reason }
  }
  // Expired census fences may have admitted terminals; do not stop after expiry.
  if (!stillFenced()) {
    return STALE_COUNT
  }
  const barrier = await stopIncumbentBehindTerminalBarrier(slot, randomUUID(), target.context)
  switch (barrier.state) {
    case 'retired':
      return { state: 'retired', version: active }
    case 'unproven':
      return {
        state: 'daemon-kept',
        version: active,
        reason:
          'This host’s Vshu server restarted, but its terminal daemon kept running because a terminal ' +
          'was open at the stop, so terminals may still lack local network access.'
      }
    case 'unsettled':
      // Recovery must retain the fence while vshud may still be stopping.
      lock.retain()
      return { state: 'kept', reason: barrier.reason, mayBeStopping: true }
    case 'withdrawn':
      return { state: 'kept', reason: barrier.reason }
  }
}
