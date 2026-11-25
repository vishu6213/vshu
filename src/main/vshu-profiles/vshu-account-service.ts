import type {
  ConnectCurrentVshuProfileResult,
  CreateCloudLinkedVshuProfileArgs,
  CreateCloudLinkedVshuProfileResult,
  VshuProfileAuthStatus,
  RefreshCurrentVshuProfileAuthResult,
  SelectVshuProfileOrgResult,
  SignOutCurrentVshuProfileResult
} from '../../shared/vshu-profiles/vshu-profiles'
import { getProfileUserDataPath } from './profile-storage-paths'
import {
  connectCurrentVshuProfile,
  createCloudLinkedVshuProfile,
  getCurrentVshuProfileAuthStatus,
  selectCurrentVshuProfileOrg,
  signOutCurrentVshuProfile
} from './cloud-auth/profile-cloud-service'
import { refreshCurrentVshuProfileAuth } from './cloud-auth/profile-cloud-capability-refresh'
import { openVshuCloudConsole } from './cloud-console/cloud-console-link'
import type {
  VshuCloudConsoleOpenResult,
  VshuCloudConsoleSection
} from '../../shared/vshu-cloud-console'
import type { VshuCloudAuthConfig } from './cloud-auth/profile-cloud-auth-config'
import { signInCurrentVshuProfileWithCode } from './cloud-auth/profile-cloud-code-sign-in'
import type { VshuCloudAuthorizationCode } from './cloud-auth/profile-cloud-pkce'
import type {
  CloudAccountTransition,
  CloudSessionCommitGuards
} from './cloud-session/profile-cloud-session-commit'

/** Side effects every account change must run, whichever caller (window or runtime RPC) made it. */
export type VshuAccountLifecycleHooks = {
  /** After a sign-in, org change or capability refresh succeeds. */
  onAuthMutation?: () => void
  /** After `onAuthMutation`, for a completed sign-in only (never a refresh), even as the same account. */
  onSignedIn?: () => void
  /** Before sign-out touches the network, so nothing keeps running as the old account. */
  onBeforeSignOut?: () => void
  onAfterSignOut?: () => void
}

export type VshuAccountServicePorts = {
  /** Hosts without a browser (vshud) never start the loopback flow, so they pass a refusing opener. */
  openBrowser: (url: string) => Promise<void>
  userDataPath?: () => string
  hooks?: VshuAccountLifecycleHooks
  /** Links other features made under an account; while they exist, only that account may be
   * signed in (D5). */
  accountBoundLinks?: AccountBoundLinks
}

export type AccountBoundLinks = {
  /** The profile whose links these are; an account change for any other profile is refused. */
  profileId: () => string | null
  /** Why `nextUserId` may not become the account, or null. A link with no recorded owner belongs
   * to `profileUserId`, the profile's current account. */
  refusal: (nextUserId: string, profileUserId: string | null) => string | null
  /** The accounts the links belong to and the bots that hold them, for a page that warns before a move. */
  holders?: (profileUserId: string | null) => { ownerUserIds: string[]; botNames: string[] }
}

/** One Vshu account per host; Electron-free so desktop and vshud share it. */
export class VshuAccountService {
  private readonly openBrowser: (url: string) => Promise<void>
  private readonly userDataPath: () => string
  private readonly hooks: VshuAccountLifecycleHooks
  private readonly accountBoundLinks: AccountBoundLinks | undefined
  private readonly signOutListeners = new Set<() => void>()

  constructor(ports: VshuAccountServicePorts) {
    this.openBrowser = ports.openBrowser
    this.userDataPath = ports.userDataPath ?? getProfileUserDataPath
    this.hooks = ports.hooks ?? {}
    this.accountBoundLinks = ports.accountBoundLinks
  }

  /** Checked against the exchanged identity right before an account is committed. */
  private readonly mayCommit = (transition: CloudAccountTransition): string | null => {
    const links = this.accountBoundLinks
    if (!links) {
      return null
    }
    if (links.profileId() !== transition.profileId) {
      return 'The Vshu profile changed during sign-in. Try again.'
    }
    return links.refusal(transition.nextUserId, transition.currentUserId)
  }

  getAuthStatus(): VshuProfileAuthStatus {
    return getCurrentVshuProfileAuthStatus(this.userDataPath())
  }

  /** What a sign-in's approval page shows before it moves this host to another account: the
   *  account it was on, and who its bots' links belong to. */
  signInContext(): {
    previous: { userId: string; email: string } | null
    links: { ownerUserIds: string[]; botNames: string[] } | null
  } {
    const cloud = this.getAuthStatus().cloud
    const previous = cloud ? { userId: cloud.userId, email: cloud.email } : null
    const links = this.accountBoundLinks?.holders?.(previous?.userId ?? null) ?? null
    return { previous, links: links && links.ownerUserIds.length > 0 ? links : null }
  }

  async connect(): Promise<ConnectCurrentVshuProfileResult> {
    const result = await connectCurrentVshuProfile(
      this.userDataPath(),
      this.openBrowser,
      this.mayCommit
    )
    if (result.status === 'connected') {
      this.hooks.onAuthMutation?.()
      this.hooks.onSignedIn?.()
    }
    return result
  }

  /** Finishes a sign-in whose browser leg ran on another device. */
  async signInWithCode(
    config: VshuCloudAuthConfig,
    code: VshuCloudAuthorizationCode,
    guards: Pick<
      CloudSessionCommitGuards,
      'signal' | 'requireSealedStorage' | 'expectedLinkEpoch'
    > = {}
  ): Promise<ConnectCurrentVshuProfileResult> {
    const result = await signInCurrentVshuProfileWithCode(this.userDataPath(), config, code, {
      ...guards,
      mayCommit: this.mayCommit
    })
    if (result.status === 'connected') {
      this.hooks.onAuthMutation?.()
      this.hooks.onSignedIn?.()
    }
    return result
  }

  /** `onCreated` runs before the account hooks, for per-profile setup the caller owns. */
  async createCloudLinked(
    args: CreateCloudLinkedVshuProfileArgs,
    onCreated?: (profileId: string) => void
  ): Promise<CreateCloudLinkedVshuProfileResult> {
    const result = await createCloudLinkedVshuProfile(this.userDataPath(), args)
    if (result.status === 'created') {
      onCreated?.(result.profile.id)
      this.hooks.onAuthMutation?.()
    }
    return result
  }

  openConsole(section: VshuCloudConsoleSection): Promise<VshuCloudConsoleOpenResult> {
    return openVshuCloudConsole(this.userDataPath(), section, this.openBrowser)
  }

  async refreshAuth(options?: {
    notifyUnchanged?: boolean
  }): Promise<RefreshCurrentVshuProfileAuthResult> {
    const previous = options?.notifyUnchanged === false ? this.getAuthStatus() : undefined
    const result = await refreshCurrentVshuProfileAuth(this.userDataPath())
    if (result.status === 'refreshed' && (!previous || authPolicyChanged(previous, result.auth))) {
      this.hooks.onAuthMutation?.()
    }
    return result
  }

  async selectOrg(orgId: string): Promise<SelectVshuProfileOrgResult> {
    const result = await selectCurrentVshuProfileOrg(this.userDataPath(), orgId)
    if (result.status === 'selected') {
      this.hooks.onAuthMutation?.()
    }
    return result
  }

  /** Every sign-out, whichever caller (window or runtime RPC) made it. */
  onSignOutStarted(listener: () => void): () => void {
    this.signOutListeners.add(listener)
    return () => {
      this.signOutListeners.delete(listener)
    }
  }

  async signOut(): Promise<SignOutCurrentVshuProfileResult> {
    for (const listener of this.signOutListeners) {
      listener()
    }
    this.hooks.onBeforeSignOut?.()
    return signOutCurrentVshuProfile(this.userDataPath()).finally(this.hooks.onAfterSignOut)
  }
}

function authPolicyChanged(previous: VshuProfileAuthStatus, next: VshuProfileAuthStatus): boolean {
  return (
    previous.cloud?.activeOrgId !== next.cloud?.activeOrgId ||
    previous.state !== next.state ||
    JSON.stringify(previous.capabilities?.flags) !== JSON.stringify(next.capabilities?.flags) ||
    JSON.stringify(previous.capabilities?.teamPolicy) !==
      JSON.stringify(next.capabilities?.teamPolicy)
  )
}
