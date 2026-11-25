import type { VshuCloudAuthConfig } from '../../../vshu-profiles/cloud-auth/profile-cloud-auth-config'
import { ensureActiveVshuProfile } from '../../../vshu-profiles/profile-index-store'
import { readFreshVshuCloudSession } from '../../../vshu-profiles/cloud-session/profile-cloud-session-refresh'
import { relayAuthConfigAt } from '../session-lifecycle/relay-renewal-origin'
import type { RelayAuthContext } from './relay-auth-identity'

export async function readRelayAuthContext(
  authConfig: VshuCloudAuthConfig,
  userDataPath: string,
  // A director-provided origin for the session refresh (relay token renewal); see RelayRenewalOrigin.
  authOrigin?: string
): Promise<RelayAuthContext | null> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (!active.profile.cloud) {
    return null
  }
  const session = await readFreshVshuCloudSession(
    authOrigin ? relayAuthConfigAt(authConfig, authOrigin) : authConfig,
    active,
    userDataPath
  )
  if (session.status !== 'found') {
    return null
  }
  // Refresh/org selection can change linkage; derive identity from post-refresh profile state.
  const refreshed = ensureActiveVshuProfile(userDataPath)
  const cloud = refreshed.profile.cloud
  if (!cloud || refreshed.profile.id !== active.profile.id) {
    return null
  }
  return {
    identity: {
      userId: cloud.userId,
      profileId: cloud.cloudProfileId,
      organizationId: cloud.activeOrgId ?? ''
    },
    accessToken: session.session.accessToken,
    relayEntitled: session.session.capabilities.flags['relay.use'] === true
  }
}
