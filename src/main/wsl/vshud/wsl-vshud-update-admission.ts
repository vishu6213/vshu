/** Reuse SSH update admission: keep newer, rolled-back or launch-rejected incumbents serving; fenced activation replans before committing. */
import {
  VSHUD_HOST_NEWER_DEFERRAL_CODE,
  VSHUD_UPDATE_WSL_MOVE_RUNNING_CODE,
  type WslHostDeferredUpdate
} from '../../../shared/remote-runtime/wsl-hosts/wsl-host-types'
import { refuseVshudHostDowngrade } from '../../managed-server/activation/vshud-host-version-admission'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshudActivationRecord } from '../../managed-server/activation/vshud-activation-record'
import { readVshudActivationRecord } from '../../managed-server/activation/vshud-activation-record-store'
import { readVshudActivationTransaction } from '../../managed-server/activation/vshud-activation-transaction-store'
import { isWaitingVshudUpdateDeferral } from '../../managed-server/lifecycle/vshud-managed-auto-update'
import {
  vshudUpdateSkipRefusal,
  planVshudUpdateForIntent,
  type ManagedVshudAutoUpdatePlan,
  type VshudUpdateIntent
} from '../../managed-server/lifecycle/vshud-managed-update-decision'
import {
  vshudUpdateFailureThisLaunch,
  recordVshudUpdateFailedThisLaunch,
  type VshudUpdateFailure,
  type VshudUpdateFailureHost
} from '../../managed-server/lifecycle/vshud-managed-update-failure-memory'
import { VSHUD_ACTIVATION_POLICY_REFUSED_CODE } from '../../managed-server/activation/vshud-installed-activation'
import type { VshudSlotOptions } from '../../managed-server/activation/vshud-recovery-slot'
import { adoptRunningVshudVersion } from '../../managed-server/activation/vshud-running-version-adoption'
import type { WslVshudLaunch } from './wsl-vshud-launch-contract'

type WslVshudReadyLaunch = Extract<WslVshudLaunch, { outcome: 'ready' }>

export type WslVshudUpdateAdmission =
  | {
      action: 'serve'
      version: string
      readiness: ServeReadiness
      deferredUpdate: WslHostDeferredUpdate | null
    }
  /** Another run holds the host fence; a later connect adopts or deploys. */
  | { action: 'defer'; deferredUpdate: WslHostDeferredUpdate }
  /** Deploy this app's build on this record. */
  | { action: 'deploy'; record: VshudActivationRecord }

export async function admitWslVshudUpdate(args: {
  slot: VshudSlotOptions
  record: VshudActivationRecord
  candidateVersion: string
  appVersion: string
  host: VshudUpdateFailureHost
  intent: VshudUpdateIntent
  /** A project move to this distro runs here: a redeploy would cut it off, even when forced. */
  moveRunning?: boolean
}): Promise<WslVshudUpdateAdmission> {
  const { record, candidateVersion, appVersion } = args
  if (!record.active) {
    return { action: 'deploy', record }
  }
  const failure = vshudUpdateFailureThisLaunch(args.host)
  const plan = planVshudUpdateForIntent(args.intent, {
    record,
    candidateVersion,
    appVersion,
    failedBefore: failure !== null
  })
  const heldForMove = args.moveRunning === true && plan.action === 'update'
  if (!heldForMove && (plan.action !== 'skip' || plan.reason === 'current')) {
    return { action: 'deploy', record }
  }
  const adopted = await adoptRunningVshudVersion(args.slot, record, candidateVersion)
  if (!adopted) {
    // Nothing active any more: deploy on the record the wake read; its fenced admission re-plans.
    return { action: 'deploy', record: await readVshudActivationRecord(args.slot) }
  }
  if ('outcome' in adopted) {
    const { candidateVersion: version, code, reason, forceable } = adopted
    return {
      action: 'defer',
      deferredUpdate: { candidateVersion: version, code, reason, forceable: forceable === true }
    }
  }
  return {
    action: 'serve',
    version: adopted.version,
    readiness: adopted.readiness,
    deferredUpdate:
      adopted.version === candidateVersion
        ? null
        : heldForMove
          ? {
              candidateVersion,
              code: VSHUD_UPDATE_WSL_MOVE_RUNNING_CODE,
              reason:
                'A project is moving to this WSL host; its server updates once the move finishes.',
              forceable: false
            }
          : skippedUpdateHint(plan, failure, record, candidateVersion, appVersion)
  }
}

/** The launch an admission ends in, or the record to deploy on. */
export async function admitWslVshudLaunch(
  args: Parameters<typeof admitWslVshudUpdate>[0],
  distro: string,
  readyLaunch: (serving: {
    fullVersion: string
    readiness: ServeReadiness
  }) => Promise<WslVshudReadyLaunch>
): Promise<WslVshudLaunch | VshudActivationRecord> {
  const admission = await admitWslVshudUpdate(args)
  if (admission.action === 'deploy') {
    return admission.record
  }
  if (admission.action === 'defer') {
    return { outcome: 'deferred', distro, ...admission.deferredUpdate }
  }
  const ready = await readyLaunch({
    fullVersion: admission.version,
    readiness: admission.readiness
  })
  return admission.deferredUpdate ? { ...ready, deferredUpdate: admission.deferredUpdate } : ready
}

/** Offer Update/Force for retriable host deferrals; newer hosts get no hint because Update cannot change that refusal. */
function skippedUpdateHint(
  plan: ManagedVshudAutoUpdatePlan,
  failure: VshudUpdateFailure | null,
  record: VshudActivationRecord,
  candidateVersion: string,
  appVersion: string
): WslHostDeferredUpdate | null {
  if (plan.action !== 'skip') {
    return null
  }
  if (plan.reason === 'failed-before' && failure) {
    return { candidateVersion, ...failure, forceable: true }
  }
  const refusal =
    plan.reason === 'rolled-back'
      ? vshudUpdateSkipRefusal(plan, record, candidateVersion, appVersion)
      : null
  return refusal
    ? {
        candidateVersion,
        code: VSHUD_ACTIVATION_POLICY_REFUSED_CODE,
        reason: refusal,
        forceable: true
      }
    : null
}

/** Do not retry rejected/thrown incumbent updates this launch, matching SSH. Waits/policy refusals never attempted activation and record no failure. */
export function recordWslVshudUpdateFailure(
  host: VshudUpdateFailureHost,
  incumbentVersion: string | null,
  failure: VshudUpdateFailure | null
): void {
  if (incumbentVersion && failure) {
    recordVshudUpdateFailedThisLaunch(host, failure)
  }
}

export function wslVshudDeferralFailure(deployed: {
  code: string
  reason: string
}): VshudUpdateFailure | null {
  return isWaitingVshudUpdateDeferral(deployed.code) ||
    deployed.code === VSHUD_ACTIVATION_POLICY_REFUSED_CODE
    ? null
    : { code: deployed.code, reason: deployed.reason }
}

/** A policy refusal over a host a newer Vshu runs gets its own code: an Update cannot pass it. */
export async function wslVshudDeferralCode(
  slot: VshudSlotOptions,
  deployed: { code: string; fullVersion: string },
  appVersion: string
): Promise<string> {
  if (deployed.code !== VSHUD_ACTIVATION_POLICY_REFUSED_CODE) {
    return deployed.code
  }
  const record = await readVshudActivationRecord(slot).catch(() => null)
  return record && refuseVshudHostDowngrade(record, deployed.fullVersion, appVersion)
    ? VSHUD_HOST_NEWER_DEFERRAL_CODE
    : deployed.code
}

/** The record only once the incumbent is back and no journal awaits recovery; else null. */
export async function readRestoredWslVshudRecord(
  slot: VshudSlotOptions,
  incumbent: string
): Promise<VshudActivationRecord | null> {
  // Unreadable transaction state proves no restoration; preserve the rejection.
  if (await readVshudActivationTransaction(slot).catch(() => true)) {
    return null
  }
  const record = await readVshudActivationRecord(slot).catch(() => null)
  return record?.active === incumbent ? record : null
}
