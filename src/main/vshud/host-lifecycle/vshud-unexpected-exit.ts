import { uptime } from 'node:os'
import type { VshudUnexpectedExit } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-unexpected-exit'
import type { VshudLockRecord } from '../instance-lock/vshud-instance-lock-record'

/** A reclaimed vshud lock from this boot means that run died; without boot evidence a reboot cannot be ruled out. */
export function reclaimedUnexpectedExit(
  holder: VshudLockRecord,
  self: Pick<VshudLockRecord, 'bootId'>,
  // Linux reads the kernel boot time; elsewhere the OS uptime gives it.
  bootStartedAtMs: number = Date.now() - uptime() * 1000
): VshudUnexpectedExit | null {
  const sameBoot =
    holder.bootId && self.bootId
      ? holder.bootId === self.bootId
      : Date.parse(holder.acquiredAt) >= bootStartedAtMs
  return holder.role !== 'desktop' && sameBoot
    ? { pid: holder.pid, version: holder.version, acquiredAt: holder.acquiredAt }
    : null
}

let previousUnexpectedExit: VshudUnexpectedExit | null = null
let runFailed = false

/** A fatal stop keeps the instance lock, so the next start reports this run as unexpected. */
export function markVshudRunFailed(): void {
  runFailed = true
}

export function vshudRunFailed(): boolean {
  return runFailed
}

/** Set once from the startup lock acquisition, before readiness publishes health. */
export function recordVshudPreviousUnexpectedExit(exit: VshudUnexpectedExit | null): void {
  previousUnexpectedExit = exit
}

export function vshudPreviousUnexpectedExit(): VshudUnexpectedExit | null {
  return previousUnexpectedExit
}
