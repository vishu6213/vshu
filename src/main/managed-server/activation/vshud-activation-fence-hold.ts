/** Retry live fences later, clear abandoned bare fences, and require recovery for interrupted journaled state. */
import {
  vshudActivationFenceExists,
  withStaleVshudActivationRecoveryLock,
  type VshudActivationLockOptions
} from './vshud-activation-lock'
import { readVshudActivationTransaction } from './vshud-activation-transaction-store'
import { vshudActivationFenceLockDir } from './vshud-activation-transaction'
import { isRelayInstallLockStale } from '../install/remote-install-lock'
import { findExitedOwnLockToken } from './vshud-exited-own-lock'
import { vshudRemoteBaseDir } from '../install/vshud-remote-windows-node'

export const VSHUD_ACTIVATION_FENCE_BUSY_CODE = 'vshud_activation_fence_busy'
const VSHUD_ACTIVATION_RECOVERY_REQUIRED_CODE = 'vshud_activation_recovery_required'

type VshudActivationFenceRefusal = {
  code: string
  reason: string
  /** Bare stale fence cleared; the caller may retry immediately. */
  cleared?: true
}

export async function vshudActivationFenceRefusal(
  options: VshudActivationLockOptions,
  attempt: string
): Promise<VshudActivationFenceRefusal> {
  const lockDir = vshudActivationFenceLockDir(options.host, options.remoteHome)
  const journal = (await readVshudActivationTransaction(options).catch(() => null)) !== null
  const baseDir = vshudRemoteBaseDir(options.host, options.remoteHome)
  const stale =
    (await findExitedOwnLockToken(options, lockDir, { baseDir, guardsStateMutation: true })) !==
      null || (await isRelayInstallLockStale(options.conn, lockDir, options.host))
  if (stale && !journal && (await clearAbandonedFence(options))) {
    return {
      code: VSHUD_ACTIVATION_FENCE_BUSY_CODE,
      reason: `An abandoned fence held this host and was cleared; the ${attempt} is retried.`,
      cleared: true
    }
  }
  const stuck = stale || (journal && !(await vshudActivationFenceExists(options).catch(() => true)))
  return stuck
    ? {
        code: VSHUD_ACTIVATION_RECOVERY_REQUIRED_CODE,
        reason: `An interrupted update or stop holds this host, so the ${attempt} did not start. Recover it first.`
      }
    : {
        code: VSHUD_ACTIVATION_FENCE_BUSY_CODE,
        reason: `Another run is changing this host’s Vshu server, so the ${attempt} did not start. It is retried on a later connect.`
      }
}

/** Drop a stale fence only after rechecking under takeover that no journal appeared. */
async function clearAbandonedFence(options: VshudActivationLockOptions): Promise<boolean> {
  try {
    return await withStaleVshudActivationRecoveryLock(options, async (lock) => {
      if (await readVshudActivationTransaction(options)) {
        lock.retain()
        return false
      }
      return true
    })
  } catch {
    // Failed takeover leaves the fence intact for normal refusal classification.
    return false
  }
}
