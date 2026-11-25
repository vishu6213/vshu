import type {
  CreateCloudLinkedVshuProfileArgs,
  VshuProfileListState
} from '../../../shared/vshu-profiles/vshu-profiles'
import type { ActiveVshuProfileState } from '../profile-index-store'
import { createCloudLinkedVshuProfileRecord, linkVshuProfileToCloud } from './profile-cloud-index'
import { readCloudSession, signInCloudSession } from '../cloud-session/profile-cloud-session-owner'
import { createDevVshuCloudSession } from './profile-cloud-dev-auth'

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedVshuProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: VshuProfileListState
    }
  | { status: 'reconnect-required' }

export function connectDevVshuCloudProfile(
  active: ActiveVshuProfileState,
  userDataPath: string
): VshuProfileListState {
  const session = createDevVshuCloudSession({ localProfileId: active.profile.id })
  signInCloudSession(active.profile.id, userDataPath, session)
  return linkVshuProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedVshuProfile(
  active: ActiveVshuProfileState,
  userDataPath: string,
  args: CreateCloudLinkedVshuProfileArgs
): DevCreateProfileResult {
  if (readCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevVshuCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedVshuProfileRecord(session.cloud, { name: args.name }, userDataPath)
  signInCloudSession(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevVshuCloudProfile(
  active: ActiveVshuProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevVshuCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkVshuProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevVshuCloudOrg(
  active: ActiveVshuProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevVshuCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkVshuProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
