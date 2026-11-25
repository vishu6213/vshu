// Vshud exit does not prove terminal exit: the terminal daemon can outlive the server.
import { VSHUD_FENCE_OWNER_FILENAME } from '../activation/vshud-activation-fence-scope'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  vshudActivationFenceExists,
  releaseVshudActivationFence,
  withVshudActivationLock
} from '../activation/vshud-activation-lock'
import { vshudLivenessProvenExited } from '../install/vshud-remote-launch'
import { readBoundedVshudRemoteRecord } from '../install/vshud-remote-record-file'
import { vshudActivationFenceLockDir } from '../activation/vshud-activation-transaction'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'

import { readVshudActivationTransaction } from '../activation/vshud-activation-transaction-store'
import {
  VSHUD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedVshudActivation
} from '../activation/vshud-activation-recovery'
import {
  ensureVshudSlotServing,
  vshudSlotDir,
  resolveVshudSlotIdentity,
  slotLiveness,
  type VshudSlotOptions
} from '../activation/vshud-recovery-slot'

type VshudManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  /** A recovery launch that failed is still a failed run. */
  | { outcome: 'fenced'; launchFailure?: Error }
  | { outcome: 'started'; readiness: ServeReadiness }
  | { outcome: 'recovery-refused'; reason: string; launchFailure?: Error }

/** Proven stopped, but the caller's gate refused a new launch; only gated wakes can see it. */
type VshudManagedGatedWake = VshudManagedWake | { outcome: 'launch-refused' }

/** Start only proven-stopped active slots; leave live or unverifiable processes alone. */
export function wakeStoppedManagedVshud(
  options: VshudSlotOptions,
  onStarting?: () => void
): Promise<VshudManagedWake>
/** `mayLaunch` is checked under the fence, at the launch decision itself. */
export function wakeStoppedManagedVshud(
  options: VshudSlotOptions,
  onStarting: (() => void) | undefined,
  mayLaunch: () => boolean
): Promise<VshudManagedGatedWake>
export function wakeStoppedManagedVshud(
  options: VshudSlotOptions,
  onStarting: () => void = () => {},
  mayLaunch: () => boolean = () => true
): Promise<VshudManagedGatedWake> {
  return serializedWake(options, (host) => wakeAfterPrior(options, host, onStarting, mayLaunch))
}

/**
 * WSL's same-version connect: one fence both confirms `expectActive` is still the active slot
 * and starts it if proven stopped. 'replan' means another version is active now; 'fenced' that
 * the fence was busy. Either way the caller takes the full deploy and wake.
 */
export function wakeExpectedVshudUnderOneFence(
  options: VshudSlotOptions,
  expectActive: string
): Promise<VshudManagedWake | { outcome: 'replan' }> {
  return serializedWake(options, async (host) => {
    // An earlier wake's dropped fence is reclaimed only by the full wake, which knows its token.
    if (interruptedWakes.has(host)) {
      return { outcome: 'fenced' }
    }
    // Record ownership before acquisition, as the wake does: a dropped reply leaves a fence only it can reclaim.
    const token = randomUUID()
    interruptedWakes.set(host, token)
    const result = await withVshudActivationLock(
      options,
      async (): Promise<VshudManagedWake | { outcome: 'replan' }> => {
        if ((await readVshudActivationRecord(options)).active !== expectActive) {
          return { outcome: 'replan' }
        }
        const liveness = await slotLiveness(options, vshudSlotDir(options, expectActive))
        if (!vshudLivenessProvenExited(liveness)) {
          return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
        }
        const identity = await resolveVshudSlotIdentity(options, expectActive)
        return { outcome: 'started', readiness: await ensureVshudSlotServing(options, identity) }
      },
      (): VshudManagedWake => ({ outcome: 'fenced' }),
      token
    )
    if (interruptedWakes.get(host) === token) {
      interruptedWakes.delete(host)
    }
    return result
  })
}

function serializedWake<T>(
  options: VshudSlotOptions,
  run: (host: string) => Promise<T>
): Promise<T> {
  const host = wakeHostKey(options)
  // Serialize per host before remote work so reconnect cannot race an earlier wake's unexplained fence.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<T> => {
    await prior?.catch(() => {})
    return run(host)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

async function wakeAfterPrior(
  options: VshudSlotOptions,
  host: string,
  onStarting: () => void,
  mayLaunch: () => boolean
): Promise<VshudManagedGatedWake> {
  const before = await readVshudActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, vshudSlotDir(options, before.active))
  if (!vshudLivenessProvenExited(liveness)) {
    await forgetSettledInterruptedWake(options, host, liveness === 'LIVE')
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await vshudActivationFenceExists(options))) {
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    // Recovery can relaunch the slot, so a refused launch skips it too.
    if (!mayLaunch()) {
      return { outcome: 'launch-refused' }
    }
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Record ownership before acquisition: dropped replies can leave fences only this token can reclaim.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withVshudActivationLock(
    options,
    async (): Promise<VshudManagedGatedWake> => {
      // Other clients may change the active slot; reread under the fence.
      const active = (await readVshudActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      if (!mayLaunch()) {
        return { outcome: 'launch-refused' }
      }
      const identity = await resolveVshudSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureVshudSlotServing(options, identity) }
    },
    (): VshudManagedWake => ({ outcome: 'fenced' }),
    token
  )
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/** Recover abandoned journals under stale, previous-boot or proven-exited fences; busy runs retain ownership. */
async function recoverAbandonedFence(
  options: VshudSlotOptions,
  onStarting: () => void
): Promise<VshudManagedWake | null> {
  const recovery = await recoverInterruptedVshudActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused': {
      // A failed launch inside recovery is still a failed run.
      const failure = recovery.launchFailure ? { launchFailure: recovery.launchFailure } : {}
      // Retry unverifiable recovery at the next fence check, as with a busy owner.
      return recovery.code === VSHUD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced', ...failure }
        : { outcome: 'recovery-refused', reason: recovery.reason, ...failure }
    }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<unknown>>()

const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: VshudSlotOptions): string {
  return joinRemotePath(
    options.host,
    vshudActivationFenceLockDir(options.host, options.remoteHome),
    VSHUD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: VshudSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/**
 * A serving slot skips the fence branch that clears an interrupted wake's token, which would
 * keep the one-fence wake off until restart. Forget it once its fence is gone or another owner's;
 * an unanswered probe proves neither, so the token stays. A fence still ours whose dropped launch
 * did start the slot (proven LIVE, no journal) is released, or deploys would wait for it to age out.
 */
async function forgetSettledInterruptedWake(
  options: VshudSlotOptions,
  host: string,
  slotLive: boolean
): Promise<void> {
  const token = interruptedWakes.get(host)
  if (!token) {
    return
  }
  try {
    const owner = (await vshudActivationFenceExists(options))
      ? await readBoundedVshudRemoteRecord(options, wakeOwnerPath(options), 64)
      : null
    const ours = owner?.state === 'present' && owner.raw.trim() === token
    if (ours && slotLive && !(await readVshudActivationTransaction(options))) {
      // The release command re-proves the owner token on the host before removing anything.
      await releaseVshudActivationFence(options, token)
    } else if (ours || owner?.state === 'absent') {
      return
    }
    if (interruptedWakes.get(host) === token) {
      interruptedWakes.delete(host)
    }
  } catch {
    // Unverifiable: keep the token for the next wake.
  }
}

/** Reclaim only this client's journal-free interrupted fence after proving slot exit. */
async function releaseOwnInterruptedWakeFence(
  options: VshudSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readVshudActivationTransaction(options))) {
    return false
  }
  // A new owner may not have written its token yet; absence cannot prove this fence ours.
  const owner = await readBoundedVshudRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseVshudActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
