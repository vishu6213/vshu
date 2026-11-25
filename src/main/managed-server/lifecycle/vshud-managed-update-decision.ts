import {
  compareAppVersions,
  isValidAppVersion
} from '../../../shared/app-lifecycle/identity/app-version'
import type { VshudManagedPastLiveTerminals } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'
import type { VshudUpdateForce } from '../activation/vshud-update-plan'
import {
  refuseVshudHostDowngrade,
  type VshudHostVersionRefusal
} from '../activation/vshud-host-version-admission'

export type ManagedVshudAutoUpdateSkip =
  | 'current'
  | 'no-template'
  | 'rolled-back'
  | 'failed-before'
  | 'migrating'
  | VshudHostVersionRefusal

/** Connect honors all skips; Update retries local failures/rollbacks; Force also lifts version skips. */
export type VshudUpdateIntent = 'connect' | 'update' | 'force'

export type ManagedVshudAutoUpdatePlan =
  | { action: 'update' }
  | { action: 'skip'; reason: ManagedVshudAutoUpdateSkip }

export function planManagedVshudAutoUpdate(input: {
  record: VshudActivationRecord
  candidateVersion: string | null
  appVersion: string
  failedBefore: boolean
}): ManagedVshudAutoUpdatePlan {
  const { record, candidateVersion } = input
  if (!candidateVersion) {
    return { action: 'skip', reason: 'no-template' }
  }
  if (record.active === candidateVersion) {
    return { action: 'skip', reason: 'current' }
  }
  if (record.rolledBackFrom === candidateVersion) {
    return { action: 'skip', reason: 'rolled-back' }
  }
  const refusal = refuseVshudHostDowngrade(record, candidateVersion, input.appVersion)
  if (refusal) {
    return { action: 'skip', reason: refusal }
  }
  // A stopped host has no serving fallback; retry even after a prior failed attempt.
  if (record.active === null && record.previous !== null) {
    return { action: 'update' }
  }
  return input.failedBefore ? { action: 'skip', reason: 'failed-before' } : { action: 'update' }
}

export function planVshudUpdateForIntent(
  intent: VshudUpdateIntent,
  input: Parameters<typeof planManagedVshudAutoUpdate>[0]
): ManagedVshudAutoUpdatePlan {
  if (intent === 'force') {
    return { action: 'update' }
  }
  if (intent === 'connect') {
    return planManagedVshudAutoUpdate(input)
  }
  const { rolledBackFrom: _retried, ...record } = input.record
  return planManagedVshudAutoUpdate({ ...input, record, failedBefore: false })
}

/** Full force over an uncounted census ends terminals vshud runs itself, so it needs a confirmation, never a bare force. */
export function managedVshudUpdateForce(input: {
  force?: boolean
  pastLiveTerminals?: VshudManagedPastLiveTerminals
  /** The caller confirmed terminals vshud runs itself end, as CLI `--force --yes` does. */
  endInProcessTerminals?: boolean
}): VshudUpdateForce | undefined {
  if (input.pastLiveTerminals) {
    return input.pastLiveTerminals.uncounted ? true : 'live-terminals'
  }
  if (!input.force) {
    return input.force
  }
  return input.endInProcessTerminals === true ? true : 'live-terminals'
}

export function admitVshudRecordForIntent(
  intent: VshudUpdateIntent,
  appVersion: string
): (record: VshudActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    vshudUpdateSkipRefusal(
      planVshudUpdateForIntent(intent, {
        record,
        candidateVersion,
        appVersion,
        failedBefore: false
      }),
      record,
      candidateVersion,
      appVersion
    )
}

export function vshudUpdateSkipRefusal(
  plan: ManagedVshudAutoUpdatePlan,
  record: VshudActivationRecord,
  candidateVersion: string,
  appVersion: string
): string | null {
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return null
  }
  return plan.reason === 'rolled-back'
    ? `This host's server rolled back from ${candidateVersion}, so a connect does not activate ` +
        'it again; choose Update or Force to retry it.'
    : `Vshu ${record.activeAppVersion} last ran this host's server, newer than this ` +
        `Vshu (${appVersion}). Update Vshu to start it.`
}

/** Content hashes cannot order updates: compare Vshu versions, or for legacy hosts offer only this desktop's previously deferred build. */
export function availableManagedVshudUpdate(input: {
  record: VshudActivationRecord
  candidateVersion: string | null
  appVersion: string
  /** The build this desktop's last Update or connect deferred on this host. */
  deferredCandidateVersion: string | null
}): string | null {
  const { record, candidateVersion, appVersion } = input
  const hostAppVersion = record.activeAppVersion
  if (!candidateVersion || record.active === null || !isValidAppVersion(appVersion)) {
    return null
  }
  const ordered = hostAppVersion
    ? isValidAppVersion(hostAppVersion) && compareAppVersions(appVersion, hostAppVersion) >= 0
    : input.deferredCandidateVersion === candidateVersion
  if (!ordered) {
    return null
  }
  // Connect rules: a build the user rolled back from is not advertised again.
  const plan = planManagedVshudAutoUpdate({
    record,
    candidateVersion,
    appVersion,
    failedBefore: false
  })
  return plan.action === 'update' ? candidateVersion : null
}

/** Update anyway was confirmed over one incumbent build; a build activated since then voids it. */
export function admitConfirmedIncumbent(
  admit: (record: VshudActivationRecord, candidateVersion: string) => string | null,
  incumbentVersion: string | null
): (record: VshudActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    record.active !== incumbentVersion
      ? "This host's server changed since the update was confirmed. Review it and update again."
      : admit(record, candidateVersion)
}
