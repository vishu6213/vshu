import type { SshTarget, SshTargetOwner } from './ssh-types'

/** The runtime id phase-3 builds wrote into `owner` before the fence moved to `vshudFence`. */
const LEGACY_MANAGED_VSHUD_RUNTIME_ID_PREFIX = 'managed-vshud:'

/** The managed Vshu server this host serves, or null for a direct SSH host. */
export function getManagedVshudFenceEnvironmentId(
  target: Pick<SshTarget, 'vshudFence'> | undefined
): string | null {
  return target?.vshudFence?.environmentId || null
}

/** Reads a legacy `owner` fence, only to migrate it to `vshudFence` on load. */
export function getLegacyManagedVshudOwnerEnvironmentId(
  owner: SshTargetOwner | undefined
): string | null {
  if (!owner?.runtimeId.startsWith(LEGACY_MANAGED_VSHUD_RUNTIME_ID_PREFIX)) {
    return null
  }
  return owner.runtimeId.slice(LEGACY_MANAGED_VSHUD_RUNTIME_ID_PREFIX.length) || null
}

export function isEphemeralRuntimeSshOwner(owner: SshTargetOwner | undefined): boolean {
  return (
    owner?.type === 'on-demand-runtime' && getLegacyManagedVshudOwnerEnvironmentId(owner) === null
  )
}

/** Every VM a recipe makes shares its label, so the runtime id keeps their server names unique. */
export function managedVshudServerName(target: Pick<SshTarget, 'label' | 'owner'>): string {
  const runtimeId = isEphemeralRuntimeSshOwner(target.owner) ? target.owner?.runtimeId : undefined
  return runtimeId ? `${target.label} VM ${runtimeId.slice(-8)}` : target.label
}

/** Refusal for a new desktop automation on a host whose managed Vshu server owns its automations. */
export function moveProjectToManagedHostFirst(host: string): string {
  return `Move this project to ${host} first.`
}
