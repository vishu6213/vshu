/** Reject activation over state a newer host build may already have migrated. */
import { compareAppVersions } from '../../../shared/app-lifecycle/identity/app-version'
import type { VshudActivationRecord } from './vshud-activation-record'

export type VshudHostVersionRefusal = 'host-newer'

export function refuseVshudHostDowngrade(
  record: VshudActivationRecord,
  candidateVersion: string,
  appVersion: string
): VshudHostVersionRefusal | null {
  // Restarting the stopped build cannot downgrade state.
  if (record.active === null && record.previous === candidateVersion) {
    return null
  }
  // Older Stop records omit app version; refuse only proven newer hosts or they would be stranded.
  if (!record.activeAppVersion) {
    return null
  }
  return compareAppVersions(record.activeAppVersion, appVersion) > 0 ? 'host-newer' : null
}
