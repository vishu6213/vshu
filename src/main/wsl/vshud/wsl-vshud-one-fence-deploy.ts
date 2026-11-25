/**
 * A same-version WSL connect takes one activation fence instead of two: the deploy confirms the
 * slot is installed and skips its own fence, then the wake's fence re-reads the record and starts
 * the slot if it stopped. A fence the snapshot saw held, another version active by then, or a busy
 * fence all run the full deploy and wake, as before.
 */
import type { VshudActivationRecord } from '../../managed-server/activation/vshud-activation-record'
import { wakeExpectedVshudUnderOneFence } from '../../managed-server/lifecycle/vshud-managed-wake'
import type {
  VshudDeployOptions,
  VshudDeployResult
} from '../../managed-server/install/vshud-remote-deploy'
import type { VshudSlotOptions } from '../../managed-server/activation/vshud-recovery-slot'

type DeployExtra = Pick<VshudDeployOptions, 'preRead' | 'sameVersionFencedByCaller'>

export async function deployWslVshudWithOneFence(
  slot: VshudSlotOptions,
  deploy: (extra: DeployExtra) => Promise<VshudDeployResult>,
  hinted: { preRead?: { record: VshudActivationRecord; fenceOpen: boolean } }
): Promise<{ deployed: VshudDeployResult; woken: boolean }> {
  if (!hinted.preRead?.fenceOpen) {
    return { deployed: await deploy(hinted), woken: false }
  }
  const first = await deploy({ ...hinted, sameVersionFencedByCaller: true })
  if (first.outcome !== 'already-active') {
    return { deployed: first, woken: false }
  }
  const wake = await wakeExpectedVshudUnderOneFence(slot, first.fullVersion)
  if (wake.outcome === 'replan' || wake.outcome === 'fenced') {
    // The host moved since the snapshot, so this deploy takes no hints.
    return { deployed: await deploy({}), woken: false }
  }
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return { deployed: first, woken: true }
}
