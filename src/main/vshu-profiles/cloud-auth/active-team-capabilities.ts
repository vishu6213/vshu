import type { VshuCloudCapabilities } from '../../../shared/vshu-profiles/vshu-cloud-capabilities'
import {
  getGoverningTeamCapabilities,
  type VshuCloudTeamFeatureFlag
} from '../../../shared/vshu-profiles/vshu-cloud-team-policy'
import type { VshuProfileSummary } from '../../../shared/vshu-profiles/vshu-profiles'
import type { VshuCloudSession } from '../cloud-session/profile-cloud-session-store'
import { sessionBelongsToProfile } from '../cloud-session/profile-cloud-session-identity'

type ActiveTeamProfile = {
  root: string
  profile: VshuProfileSummary
  session: Pick<VshuCloudSession, 'identity' | 'capabilities' | 'organizations'> | undefined
  sessionRevision: number
}

let active: ActiveTeamProfile | undefined
let queued = false
const listeners = new Set<() => void>()

function getActiveCloudSession(): ActiveTeamProfile['session'] {
  const cloud = active?.profile.cloud
  const session = active?.session
  return cloud && session && sessionBelongsToProfile(session, cloud) ? session : undefined
}

export function getActiveTeamCapabilities(): VshuCloudCapabilities | undefined {
  return getGoverningTeamCapabilities(getActiveCloudSession()?.capabilities)
}

export function getActivePolicyRefreshState(): 'governed' | 'member' | 'personal' | undefined {
  const session = getActiveCloudSession()
  if (!session) {
    return undefined
  }
  if (getGoverningTeamCapabilities(session.capabilities)) {
    return 'governed'
  }
  return session.organizations?.length || active?.profile.cloud?.activeOrgId ? 'member' : 'personal'
}

export function getActiveTeamProfileScope():
  | { profileId: string; userId: string; cloudProfileId: string; root: string }
  | undefined {
  const profile = active?.profile
  if (active && profile?.cloud && getActiveTeamCapabilities()) {
    return {
      profileId: profile.id,
      userId: profile.cloud.userId,
      cloudProfileId: profile.cloud.cloudProfileId,
      root: active.root
    }
  }
  return undefined
}

export function initializeActiveTeamProfile(
  root: string,
  profile: VshuProfileSummary
): (session: VshuCloudSession | undefined) => void {
  const candidate: ActiveTeamProfile = { root, profile, session: undefined, sessionRevision: 0 }
  active = candidate
  return (session) => {
    if (active === candidate && candidate.sessionRevision === 0) {
      observeActiveTeamSession(root, profile.id, session)
    }
  }
}

export function observeActiveTeamProfile(root: string, profile: VshuProfileSummary): void {
  if (active?.root !== root) {
    return
  }
  if (active.profile.id !== profile.id) {
    active = { root, profile, session: undefined, sessionRevision: 0 }
  } else {
    active.profile = profile
  }
  notify()
}

export function observeActiveTeamSession(
  root: string,
  profileId: string,
  session: VshuCloudSession | undefined
): void {
  if (active?.root !== root || active.profile.id !== profileId) {
    return
  }
  active.session = session
    ? {
        identity: session.identity,
        capabilities: session.capabilities,
        organizations: session.organizations
      }
    : undefined
  active.sessionRevision++
  notify()
}

function notify(): void {
  if (queued || listeners.size === 0) {
    return
  }
  queued = true
  queueMicrotask(() => {
    queued = false
    for (const listener of listeners) {
      listener()
    }
  })
}

export function onTeamCapabilitiesInvalidated(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isTeamFeatureBlocked(flag: VshuCloudTeamFeatureFlag): boolean {
  return getActiveTeamCapabilities()?.flags[flag] === false
}

export function onTeamFeatureBlockChanged(
  flag: VshuCloudTeamFeatureFlag,
  listener: (blocked: boolean) => void
): () => void {
  let blocked = isTeamFeatureBlocked(flag)
  return onTeamCapabilitiesInvalidated(() => {
    const next = isTeamFeatureBlocked(flag)
    if (next !== blocked) {
      blocked = next
      listener(blocked)
    }
  })
}
