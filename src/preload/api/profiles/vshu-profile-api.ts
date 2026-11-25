import type {
  VshuCloudSignInProgress,
  ConnectCurrentVshuProfileResult,
  CreateCloudLinkedVshuProfileArgs,
  CreateCloudLinkedVshuProfileResult,
  CreateLocalVshuProfileArgs,
  CreateLocalVshuProfileResult,
  FindVshuProfileProjectsByPathArgs,
  FindVshuProfileProjectsByPathResult,
  VshuProfileAuthStatus,
  VshuProfileListResult,
  VshuProfileOrgInviteRevokeArgs,
  VshuProfileOrgMemberChangeRoleArgs,
  VshuProfileOrgMemberInviteArgs,
  VshuProfileOrgMemberMutationResult,
  VshuProfileOrgMemberRemoveArgs,
  VshuProfileOrgMembersListArgs,
  VshuProfileOrgMembersListResult,
  RefreshCurrentVshuProfileAuthResult,
  SelectVshuProfileOrgArgs,
  SelectVshuProfileOrgResult,
  SignOutCurrentVshuProfileResult,
  SwitchVshuProfileArgs,
  SwitchVshuProfileResult,
  TransferVshuProfileProjectArgs,
  TransferVshuProfileProjectResult
} from '../../../shared/vshu-profiles/vshu-profiles'
import type {
  VshuCloudConsoleOpenArgs,
  VshuCloudConsoleOpenResult
} from '../../../shared/vshu-cloud-console'

export type VshuProfileApi = {
  list: () => Promise<VshuProfileListResult>
  authStatus: () => Promise<VshuProfileAuthStatus>
  /** Fires when main changed the stored auth status on its own (e.g. a revoked session). */
  onAuthStatusChanged: (callback: () => void) => () => void
  createLocal: (args?: CreateLocalVshuProfileArgs) => Promise<CreateLocalVshuProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedVshuProfileArgs
  ) => Promise<CreateCloudLinkedVshuProfileResult>
  switchProfile: (args: SwitchVshuProfileArgs) => Promise<SwitchVshuProfileResult>
  transferProject: (
    args: TransferVshuProfileProjectArgs
  ) => Promise<TransferVshuProfileProjectResult>
  findProjectProfiles: (
    args: FindVshuProfileProjectsByPathArgs
  ) => Promise<FindVshuProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentVshuProfileResult>
  signInProgress: () => Promise<VshuCloudSignInProgress | null>
  onSignInProgressChanged: (
    callback: (progress: VshuCloudSignInProgress | null) => void
  ) => () => void
  cancelSignIn: () => Promise<void>
  refreshAuth: () => Promise<RefreshCurrentVshuProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentVshuProfileResult>
  selectOrg: (args: SelectVshuProfileOrgArgs) => Promise<SelectVshuProfileOrgResult>
  orgMembersList: (args: VshuProfileOrgMembersListArgs) => Promise<VshuProfileOrgMembersListResult>
  orgMemberInvite: (
    args: VshuProfileOrgMemberInviteArgs
  ) => Promise<VshuProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: VshuProfileOrgInviteRevokeArgs
  ) => Promise<VshuProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: VshuProfileOrgMemberChangeRoleArgs
  ) => Promise<VshuProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: VshuProfileOrgMemberRemoveArgs
  ) => Promise<VshuProfileOrgMemberMutationResult>
  /** Opens a web console page in the system browser, signed in when auth issues a ticket. */
  openCloudConsole: (args: VshuCloudConsoleOpenArgs) => Promise<VshuCloudConsoleOpenResult>
}
