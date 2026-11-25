import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import { RUNTIME_OWNED_SSH_TARGET_ID_PREFIX } from '../../../shared/execution-host/execution-host'

export function getRuntimeOwnedSshTargetId(runtimeId: string): string {
  return `${RUNTIME_OWNED_SSH_TARGET_ID_PREFIX}${runtimeId}`
}

/** Any target Vshu created as an implementation detail; hidden from SSH-host surfaces. */
export function isRuntimeOwnedSshTarget(target: SshTarget): boolean {
  return target.owner !== undefined
}

/** A host serving (or being set up for) a managed Vshu server: visible, but never a direct relay. */
export function isManagedVshudSshTarget(target: SshTarget): boolean {
  return target.vshudFence !== undefined || target.vshudProvisioning !== undefined
}

/** Managed hosts cannot serve direct relays unless older retained projects still require their previous relay. */
export function allowsDirectSshRelay(target: SshTarget): boolean {
  if (target.vshudProvisioning) {
    return false
  }
  return !target.vshudFence || target.vshudFence.sourceChangedAt !== undefined
}
