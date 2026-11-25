import type { VshudManagedDeferral } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'

type RecordedDeferral = VshudManagedDeferral & { deferredAt: string }

/** Which activation a host is on: a version alone repeats when a host moves away and back. */
export type VshudIncumbent = Pick<VshudActivationRecord, 'active' | 'activatedAt'>

type StoredDeferral = RecordedDeferral & {
  /** The host's activation when the deferral was recorded. */
  incumbentAtDeferral: VshudIncumbent
}

const deferrals = new Map<string, StoredDeferral>()

export function recordManagedVshudUpdateDeferral(
  environmentId: string,
  deferral: VshudManagedDeferral,
  incumbent: VshudIncumbent,
  now = new Date()
): void {
  deferrals.set(environmentId, {
    ...deferral,
    deferredAt: now.toISOString(),
    incumbentAtDeferral: { active: incumbent.active, activatedAt: incumbent.activatedAt }
  })
}

export function clearManagedVshudUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

/** Forget a deferral once the host's activation moves, since it described a host state that is gone
 *  (builds of one release differ only by an unorderable content hash, #38400), or once its candidate
 *  is the build the host runs, since nothing is left to update. */
export function currentManagedVshudUpdateDeferral(
  environmentId: string,
  incumbent: VshudIncumbent
): RecordedDeferral | null {
  const stored = deferrals.get(environmentId)
  if (!stored) {
    return null
  }
  const { incumbentAtDeferral, ...deferral } = stored
  if (
    incumbent.active === deferral.candidateVersion ||
    incumbentAtDeferral.active !== incumbent.active ||
    incumbentAtDeferral.activatedAt !== incumbent.activatedAt
  ) {
    clearManagedVshudUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
