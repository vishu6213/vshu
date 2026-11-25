import { ipcMain } from 'electron'
import type {
  VshuOrgRole,
  VshuProfileOrgInviteRevokeArgs,
  VshuProfileOrgMemberChangeRoleArgs,
  VshuProfileOrgMemberInviteArgs,
  VshuProfileOrgMemberMutationResult,
  VshuProfileOrgMemberRemoveArgs,
  VshuProfileOrgMembersListArgs,
  VshuProfileOrgMembersListResult
} from '../../../shared/vshu-profiles/vshu-profiles'
import { getProfileUserDataPath } from '../../vshu-profiles/profile-storage-paths'
import {
  changeVshuProfileOrgMemberRole,
  inviteVshuProfileOrgMember,
  listVshuProfileOrgMembers,
  removeVshuProfileOrgMember,
  revokeVshuProfileOrgInvite
} from '../../vshu-profiles/cloud-org/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_vshu_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_vshu_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): VshuOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_vshu_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_vshu_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_vshu_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): VshuProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): VshuProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): VshuProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): VshuProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerVshuProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'vshuProfiles:orgMembersList',
    async (
      _event,
      rawArgs: VshuProfileOrgMembersListArgs
    ): Promise<VshuProfileOrgMembersListResult> =>
      listVshuProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'vshuProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: VshuProfileOrgMemberInviteArgs
    ): Promise<VshuProfileOrgMemberMutationResult> =>
      inviteVshuProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'vshuProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: VshuProfileOrgInviteRevokeArgs
    ): Promise<VshuProfileOrgMemberMutationResult> =>
      revokeVshuProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'vshuProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: VshuProfileOrgMemberChangeRoleArgs
    ): Promise<VshuProfileOrgMemberMutationResult> =>
      changeVshuProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'vshuProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: VshuProfileOrgMemberRemoveArgs
    ): Promise<VshuProfileOrgMemberMutationResult> =>
      removeVshuProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
