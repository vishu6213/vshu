import type { BrowserSessionProfile } from '../../../../../shared/browser/workspaces/browser-workspace-types'
import { VSHU_BROWSER_PARTITION } from '../../../../../shared/browser/browser-session-partition'
import { getVshuProfileBrowserDefaultPartition } from '../../../../../shared/vshu-profiles/vshu-profiles'
import { unadmittedBrowserPartition } from '../../../../../shared/browser/profiles/browser-profile-scope'

export function resolveBrowserPagePartition({
  sessionProfileId,
  sessionPartition,
  localProfiles,
  mirroredProfiles,
  activeVshuProfileId
}: {
  sessionProfileId: string | null
  sessionPartition: string | null
  localProfiles: readonly BrowserSessionProfile[] | undefined
  mirroredProfiles: readonly BrowserSessionProfile[]
  activeVshuProfileId: string | null
}): string {
  const browserSessionProfiles = localProfiles ?? mirroredProfiles
  const fallbackBrowserPartition = activeVshuProfileId
    ? getVshuProfileBrowserDefaultPartition(activeVshuProfileId)
    : null
  const defaultSessionProfile = browserSessionProfiles.find((p) => p.id === 'default') ?? null
  const sessionProfile = sessionProfileId
    ? (browserSessionProfiles.find((p) => p.id === sessionProfileId) ?? null)
    : defaultSessionProfile
  if (sessionPartition) {
    return sessionPartition
  }
  // A deleted profile must not fall back to Default's cookie jar.
  if (sessionProfileId && !sessionProfile && localProfiles) {
    return unadmittedBrowserPartition(sessionProfileId)
  }
  return (
    sessionProfile?.partition ??
    defaultSessionProfile?.partition ??
    fallbackBrowserPartition ??
    VSHU_BROWSER_PARTITION
  )
}
