import { getVshuProfileBrowserSessionPartition } from '../../../../shared/vshu-profiles/vshu-profiles'
import type { BrowserSessionProfile } from '../../../../shared/browser/workspaces/browser-workspace-types'

const BROWSER_SESSION_PROFILE_ID_RE =
  /^[\da-f-]{8}-[\da-f-]{4}-[\da-f-]{4}-[\da-f-]{4}-[\da-f-]{12}$/

// Persisted metadata must not add arbitrary partitions to the webview allowlist.
export function isValidPersistedBrowserSessionProfile(
  profile: unknown,
  activeVshuProfileId: string
): profile is BrowserSessionProfile {
  if (!profile || typeof profile !== 'object') {
    return false
  }
  const candidate = profile as Partial<BrowserSessionProfile>
  return (
    candidate.id !== 'default' &&
    candidate.scope !== 'default' &&
    typeof candidate.id === 'string' &&
    typeof candidate.partition === 'string' &&
    typeof candidate.label === 'string' &&
    isProfileOwnedSessionPartition(candidate.id, candidate.partition, activeVshuProfileId)
  )
}

function isProfileOwnedSessionPartition(
  profileId: string,
  partition: string,
  activeVshuProfileId: string
): boolean {
  return (
    BROWSER_SESSION_PROFILE_ID_RE.test(profileId) &&
    partition === getVshuProfileBrowserSessionPartition(activeVshuProfileId, profileId)
  )
}
