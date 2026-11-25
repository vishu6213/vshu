import { writeVshudActivationRecord } from '../activation/vshud-activation-record-store'
import type { VshudActivationRecoveryResult } from '../activation/vshud-activation-recovery'
import type { VshudDecommissionRecoveryPlan } from './vshud-decommission-transaction'
import { settleVshudDecommissionStop } from './vshud-decommission-stop'
import {
  vshudLivenessProbeCommand,
  vshudLivenessProvenExited,
  parseVshudLiveness
} from '../install/vshud-remote-launch'
import { execVshudRemote } from '../install/vshud-remote-runtime-control'
import {
  ensureVshudSlotServing,
  vshudSlotDir,
  resolveVshudSlotIdentity,
  type VshudSlotOptions
} from '../activation/vshud-recovery-slot'

/** Only proven exit clears an interrupted decommission journal. */
export async function reconcileVshudDecommission(
  options: VshudSlotOptions,
  plan: VshudDecommissionRecoveryPlan
): Promise<VshudActivationRecoveryResult> {
  if (plan.action === 'keep-serving') {
    const identity = await resolveVshudSlotIdentity(options, plan.version)
    return {
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: plan.version,
      readiness: await ensureVshudSlotServing(options, identity)
    }
  }
  if (plan.action === 'resume-stop') {
    const settlement = await settleVshudDecommissionStop(options, plan.request)
    if (settlement.state === 'unsettled') {
      return {
        outcome: 'refused',
        verdict: settlement.verdict,
        code: 'vshud_recovery_decommission_unsettled',
        reason: settlement.reason
      }
    }
    if (settlement.state === 'withdrawn') {
      return reconcileVshudDecommission(options, {
        action: 'keep-serving',
        version: plan.request.version
      })
    }
    return reconcileVshudDecommission(options, {
      action: 'confirm-decommissioned',
      version: plan.request.version,
      record: plan.record
    })
  }
  // Live or unanswered slots retain the fence; only proven exit permits commit.
  const liveness = parseVshudLiveness(
    await execVshudRemote(
      options,
      vshudLivenessProbeCommand(options.host, vshudSlotDir(options, plan.version))
    )
  )
  if (!vshudLivenessProvenExited(liveness)) {
    return {
      outcome: 'refused',
      verdict: liveness === 'LIVE' ? 'live' : 'unverifiable',
      code: 'vshud_recovery_decommissioned_slot_not_exited',
      reason: `vshud ${plan.version} is recorded as stopped but is ${liveness.toLowerCase()}.`
    }
  }
  if (plan.record) {
    await writeVshudActivationRecord(options, plan.record)
  }
  return { outcome: 'recovered', resolution: 'committed', activeVersion: null, readiness: null }
}
