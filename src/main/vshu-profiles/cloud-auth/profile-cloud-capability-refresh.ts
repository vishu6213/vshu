import type { RefreshCurrentVshuProfileAuthResult } from '../../../shared/vshu-profiles/vshu-profiles'
import { getVshuCloudAuthConfig, isVshuCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getVshuProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshVshuCloudCapabilities } from './profile-cloud-client'
import { ensureActiveVshuProfile } from '../profile-index-store'
import { refreshDevVshuCloudProfile } from './profile-cloud-dev-service'
import {
  commitCloudSessionCapabilities,
  takeCloudSessionTicket,
  type CloudSessionTicket
} from '../cloud-session/profile-cloud-session-owner'
import { runWithFreshVshuCloudSession } from '../cloud-session/profile-cloud-session-refresh'

export async function refreshCurrentVshuProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentVshuProfileAuthResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  const auth = () => getVshuProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isVshuCloudDevAuthEnabled()) {
    const result = refreshDevVshuCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const cloud = active.profile.cloud
    let ticket: CloudSessionTicket | undefined
    const operation = await runWithFreshVshuCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => {
        // Take the ticket after refresh because refreshing may relink the session.
        ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
        return refreshVshuCloudCapabilities(configState.config, session)
      }
    )
    if (operation.status !== 'ok' || !ticket) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (
      refresh.cloud &&
      (refresh.cloud.userId !== cloud.userId ||
        refresh.cloud.cloudProfileId !== cloud.cloudProfileId)
    ) {
      throw new Error('vshu_cloud_identity_changed_during_capability_refresh')
    }
    const list = commitCloudSessionCapabilities(active.profile.id, userDataPath, ticket, refresh)
    if (!list) {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: getVshuProfileAuthStatusFromProfile(
        ensureActiveVshuProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
