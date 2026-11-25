/** Pair with an already-running foreign build before considering update; an unpaired first deploy cannot census its terminals. */
import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshudManagedDeferral } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { vshudActivationFenceRefusal } from './vshud-activation-fence-hold'
import { VshudActiveReadinessError, probeActiveVshudReadiness } from './vshud-active-readiness'
import type { VshudActivationRecord } from './vshud-activation-record'
import { readVshudActivationRecord } from './vshud-activation-record-store'
import { wakeStoppedManagedVshud } from '../lifecycle/vshud-managed-wake'
import { resolveVshudSlotIdentity, type VshudSlotOptions } from './vshud-recovery-slot'

export type VshudRunningAdoption = {
  version: string
  readiness: ServeReadiness
  /** Reads the adopted slot's readiness again, e.g. after it rebinds its port. */
  reprobe: () => Promise<ServeReadiness>
}

/** No foreign activation returns null for normal deploy. A held peer fence defers: deploying without pairing would only fail census (#28833). */
export async function adoptRunningVshudVersion(
  slot: VshudSlotOptions,
  record: VshudActivationRecord,
  localVersion: string,
  retryClearedFence = true
): Promise<VshudRunningAdoption | VshudManagedDeferral | null> {
  if (!record.active || record.active === localVersion) {
    return null
  }
  // Wake only on proven server exit; idle stops leave daemon terminals alive.
  const wake = await wakeStoppedManagedVshud(slot)
  switch (wake.outcome) {
    // Another desktop stopped it meanwhile; the deploy's own gates decide.
    case 'not-activated':
      return null
    case 'fenced': {
      // E.g. another desktop starting it after a reboot; a later connect pairs with it.
      const { cleared, ...refusal } = await vshudActivationFenceRefusal(slot, 'server start')
      if (cleared && retryClearedFence) {
        return adoptRunningVshudVersion(slot, record, localVersion, false)
      }
      return { outcome: 'deferred', candidateVersion: localVersion, ...refusal, forceable: false }
    }
    case 'unverifiable':
      throw new VshudActiveReadinessError(
        'unverifiable',
        `Vshu ${record.active} runs this host's server, but its process state is unverifiable, ` +
          'so it was left as it is. Try connecting again.'
      )
    case 'recovery-refused':
      throw new Error(wake.reason)
    case 'serving':
    case 'started':
      break
  }
  // Re-read activation because wake follows peer changes to the current record.
  const active = (await readVshudActivationRecord(slot)).active
  if (!active || active === localVersion) {
    return null
  }
  const identity = await resolveVshudSlotIdentity(slot, active)
  const reprobe = () =>
    probeActiveVshudReadiness(
      { ...slot, remoteInstallDir: identity.remoteDir },
      { buildHash: identity.buildHash, fullVersion: identity.version }
    )
  return { version: active, readiness: await reprobe(), reprobe }
}
