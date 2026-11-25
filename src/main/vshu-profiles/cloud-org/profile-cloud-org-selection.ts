import type { VshuCloudAuthConfig } from '../cloud-auth/profile-cloud-auth-config'
import { VshuCloudRequestError, selectVshuCloudOrg } from '../cloud-auth/profile-cloud-client'
import { forceRefreshVshuCloudSession } from '../cloud-session/profile-cloud-session-refresh'
import type { ActiveVshuProfileState } from '../profile-index-store'
import type { VshuProfileListState } from '../../../shared/vshu-profiles/vshu-profiles'
import {
  beginCloudSessionRelink,
  commitCloudSessionRelink,
  readCloudSession
} from '../cloud-session/profile-cloud-session-owner'

export async function selectCloudOrg(input: {
  config: VshuCloudAuthConfig
  active: ActiveVshuProfileState
  userDataPath: string
  orgId: string
}): Promise<VshuProfileListState | null> {
  const profileId = input.active.profile.id
  const cloud = input.active.profile.cloud
  const stored = readCloudSession(profileId, input.userDataPath)
  if (!cloud || stored.status !== 'found') {
    return null
  }
  const ticket = beginCloudSessionRelink(profileId, input.userDataPath)
  let selected
  try {
    selected = await selectVshuCloudOrg(input.config, stored.session, input.orgId)
  } catch (error) {
    if (!(error instanceof VshuCloudRequestError) || error.statusCode !== 401) {
      throw error
    }
    const refreshed = await forceRefreshVshuCloudSession(
      input.config,
      input.active,
      input.userDataPath,
      stored.session
    )
    if (refreshed.status !== 'found') {
      throw error
    }
    selected = await selectVshuCloudOrg(input.config, refreshed.session, input.orgId)
  }
  if (
    selected.cloud.userId !== cloud.userId ||
    selected.cloud.cloudProfileId !== cloud.cloudProfileId ||
    selected.cloud.activeOrgId !== input.orgId
  ) {
    throw new Error('vshu_cloud_org_selection_identity_mismatch')
  }
  const list = commitCloudSessionRelink(profileId, input.userDataPath, ticket, selected)
  if (!list) {
    throw new Error('stale_cloud_session_mutation')
  }
  return list
}
