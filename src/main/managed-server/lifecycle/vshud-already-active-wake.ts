import { VshudCrashLoopError, wakeManagedVshudUnlessCrashLooping } from './vshud-managed-crash-loop'
import { wakeStoppedManagedVshud } from './vshud-managed-wake'
import type { VshudSlotOptions } from '../activation/vshud-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveVshud(
  options: VshudSlotOptions,
  /** SSH-managed hosts share the crash-loop brake with every other automatic wake. */
  managed?: { environmentId: string; hostLabel: string }
): Promise<boolean> {
  const wake = managed
    ? await wakeManagedVshudUnlessCrashLooping(managed.environmentId, managed.hostLabel, options)
    : await wakeStoppedManagedVshud(options)
  if (wake.outcome === 'crash-loop') {
    throw new VshudCrashLoopError(wake.detail)
  }
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
