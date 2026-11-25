import type {
  VshuProfileOrgInviteRevokeArgs,
  VshuProfileOrgMemberChangeRoleArgs,
  VshuProfileOrgMemberInviteArgs,
  VshuProfileOrgMemberMutationResult,
  VshuProfileOrgMemberRemoveArgs,
  VshuProfileOrgMembersListResult
} from '../../../shared/vshu-profiles/vshu-profiles'
import type { ActiveVshuProfileState } from '../profile-index-store'
import { ensureActiveVshuProfile } from '../profile-index-store'
import type { VshuCloudAuthConfig } from '../cloud-auth/profile-cloud-auth-config'
import {
  getVshuCloudAuthConfig,
  isVshuCloudDevAuthEnabled
} from '../cloud-auth/profile-cloud-auth-config'
import type { VshuCloudSession } from '../cloud-session/profile-cloud-session-store'
import { VshuCloudRequestError } from '../cloud-auth/profile-cloud-client'
import { runWithFreshVshuCloudSession } from '../cloud-session/profile-cloud-session-refresh'
import {
  changeVshuCloudOrgMemberRole,
  inviteVshuCloudOrgMember,
  listVshuCloudOrgMembers,
  removeVshuCloudOrgMember,
  revokeVshuCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevVshuCloudOrgMemberRole,
  inviteDevVshuCloudOrgMember,
  listDevVshuCloudOrgMembers,
  removeDevVshuCloudOrgMember,
  revokeDevVshuCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: VshuCloudRequestError }
  | { status: 'failed'; error: string }

// Only 401 should trigger session refresh; return business/permission failures as values.
async function runOrgMemberCall<T>(
  config: VshuCloudAuthConfig,
  active: ActiveVshuProfileState,
  userDataPath: string,
  call: (session: VshuCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshVshuCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof VshuCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(error: VshuCloudRequestError): VshuProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): VshuProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listVshuProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<VshuProfileOrgMembersListResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevVshuCloudOrgMembers(orgId) }
  }
  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listVshuCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteVshuProfileOrgMember(
  userDataPath: string,
  args: VshuProfileOrgMemberInviteArgs
): Promise<VshuProfileOrgMemberMutationResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    return inviteDevVshuCloudOrgMember(args)
  }
  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteVshuCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeVshuProfileOrgInvite(
  userDataPath: string,
  args: VshuProfileOrgInviteRevokeArgs
): Promise<VshuProfileOrgMemberMutationResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    return revokeDevVshuCloudOrgInvite(args)
  }
  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeVshuCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeVshuProfileOrgMemberRole(
  userDataPath: string,
  args: VshuProfileOrgMemberChangeRoleArgs
): Promise<VshuProfileOrgMemberMutationResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    return changeDevVshuCloudOrgMemberRole(args)
  }
  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeVshuCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeVshuProfileOrgMember(
  userDataPath: string,
  args: VshuProfileOrgMemberRemoveArgs
): Promise<VshuProfileOrgMemberMutationResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    return removeDevVshuCloudOrgMember(args)
  }
  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeVshuCloudOrgMember(configState.config, session, args)
    )
  )
}
