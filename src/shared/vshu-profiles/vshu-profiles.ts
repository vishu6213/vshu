import './constants'
import { VSHU_BROWSER_PARTITION } from '../browser/browser-session-partition'
import type { ExecutionHostId } from '../execution-host/execution-host'

export const VSHU_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_VSHU_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_VSHU_PROFILE_NAME = 'Personal'
/** Main -> renderer push when the stored auth status changed without the renderer asking. */
export const VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL = 'vshuProfiles:authStatusChanged'
export const VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL = 'vshuProfiles:signInProgressChanged'
const LEGACY_VSHU_BROWSER_SESSION_PARTITION_PREFIX = 'persist:vshu-browser-session-'

export type VshuProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type VshuProfileKind = 'local' | 'cloud-linked'

export type VshuProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type VshuCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type VshuCloudCapabilityFlags = Record<string, boolean>

export type VshuCloudCapabilities = {
  flags: VshuCloudCapabilityFlags
  refreshedAt: number
}

export type VshuCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type VshuProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type VshuProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: VshuProfileAuthState
  persistence: VshuCloudSessionPersistence
  cloud?: VshuProfileCloudSummary
  organizations?: VshuCloudOrgSummary[]
  capabilities?: VshuCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type VshuProfileSummary = {
  id: string
  name: string
  avatar: VshuProfileAvatar
  kind: VshuProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: VshuProfileCloudSummary
}

export type VshuProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: VshuProfileSummary[]
}

export type VshuProfileListState = {
  activeProfileId: string
  profiles: VshuProfileSummary[]
}

export type VshuProfileListResult = VshuProfileListState & {
  // Gate the multi-profile switcher; default builds use one-profile account menus.
  multiProfileUi: boolean
}

export type CreateLocalVshuProfileArgs = {
  name?: string
}

export type CreateLocalVshuProfileResult = VshuProfileListState & {
  profile: VshuProfileSummary
}

export type CreateCloudLinkedVshuProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchVshuProfileArgs = {
  profileId: string
}

export type SwitchVshuProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferVshuProfileProjectMode = 'move' | 'copy'

export type TransferVshuProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferVshuProfileProjectMode
}

export type FindVshuProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type VshuProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: VshuProfileKind
  repoId: string
  repoName: string
}

export type FindVshuProfileProjectsByPathResult = {
  projects: VshuProfileProjectPresence[]
}

export type TransferVshuProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferVshuProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

/** A sign-in in flight; `link` is set only while the browser has not answered yet. */
export type VshuCloudSignInProgress = { link: string | null }

export type ConnectCurrentVshuProfileResult =
  | {
      status: 'connected'
      auth: VshuProfileAuthStatus
      activeProfileId: string
      profiles: VshuProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: VshuProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: VshuProfileAuthStatus
    }
  | {
      status: 'timed-out'
      auth: VshuProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: VshuProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedVshuProfileResult =
  | {
      status: 'created'
      auth: VshuProfileAuthStatus
      activeProfileId: string
      profiles: VshuProfileSummary[]
      profile: VshuProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: VshuProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: VshuProfileAuthStatus
      error: string
    }

export type SignOutCurrentVshuProfileResult = {
  status: 'signed-out'
  auth: VshuProfileAuthStatus
  activeProfileId: string
  profiles: VshuProfileSummary[]
}

export type SelectVshuProfileOrgArgs = {
  orgId: string
}

export type SelectVshuProfileOrgResult =
  | {
      status: 'selected'
      auth: VshuProfileAuthStatus
      activeProfileId: string
      profiles: VshuProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: VshuProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: VshuProfileAuthStatus
      error: string
    }

export type RefreshCurrentVshuProfileAuthResult =
  | {
      status: 'refreshed'
      auth: VshuProfileAuthStatus
      activeProfileId: string
      profiles: VshuProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: VshuProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: VshuProfileAuthStatus
      error: string
    }

// Mirror the server’s fixed role enum so UI options cannot drift from accepted API values.
export type VshuOrgRole = 'owner' | 'admin' | 'member'

export type VshuOrgMember = {
  // Provisioned teammates without sign-in have no userId; disable mutations requiring that key.
  userId: string | null
  email: string
  displayName?: string
  role: VshuOrgRole
}

export type VshuOrgPendingInvite = {
  email: string
  role: VshuOrgRole
  createdAt: number
}

export type VshuOrgMembersRoster = {
  members: VshuOrgMember[]
  pendingInvites: VshuOrgPendingInvite[]
  viewerRole: VshuOrgRole
  canManageMembers: boolean
}

export type VshuProfileOrgMembersListArgs = {
  orgId: string
}

export type VshuProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: VshuOrgRole
}

export type VshuProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type VshuProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: VshuOrgRole
}

export type VshuProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type VshuProfileOrgMembersListResult =
  | { status: 'ok'; roster: VshuOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type VshuOrgInviteConflictReason = 'already_member' | 'already_invited'
export type VshuOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type VshuProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: VshuOrgInviteConflictReason }
  | { status: 'invalid'; reason: VshuOrgMutationInvalidReason }
  | { status: 'failed'; error: string }

export function createDefaultLocalVshuProfile(now: number): VshuProfileSummary {
  return {
    id: DEFAULT_LOCAL_VSHU_PROFILE_ID,
    name: DEFAULT_LOCAL_VSHU_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getVshuProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getVshuProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_VSHU_PROFILE_ID) {
    return VSHU_BROWSER_PARTITION
  }
  return `persist:vshu-profile-${getVshuProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getVshuProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_VSHU_PROFILE_ID) {
    return `${LEGACY_VSHU_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:vshu-profile-${getVshuProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
