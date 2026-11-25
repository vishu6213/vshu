import type {
  ConnectCurrentVshuProfileResult,
  CreateCloudLinkedVshuProfileArgs,
  CreateCloudLinkedVshuProfileResult,
  VshuProfileAuthStatus,
  SelectVshuProfileOrgResult,
  SignOutCurrentVshuProfileResult
} from '../../../shared/vshu-profiles/vshu-profiles'
import { ensureActiveVshuProfile } from '../profile-index-store'
import { getVshuCloudAuthConfig, isVshuCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  invalidateCloudSessionChanges,
  readCloudSession,
  signInCloudSession,
  signOutCloudSession
} from '../cloud-session/profile-cloud-session-owner'
import {
  createVshuCloudProfile,
  exchangeVshuCloudAuthCode,
  revokeVshuCloudSession
} from './profile-cloud-client'
import { beginVshuCloudPkceFlow, type VshuCloudBrowserReturn } from './profile-cloud-pkce'
import { vshuCloudCallbackOutcomeOf } from './profile-cloud-callback-page'
import {
  createCloudLinkedVshuProfileRecord,
  unlinkVshuProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshVshuCloudSession } from '../cloud-session/profile-cloud-session-refresh'
import {
  connectDevVshuCloudProfile,
  createDevCloudLinkedVshuProfile,
  selectDevVshuCloudOrg
} from './profile-cloud-dev-service'
import { getVshuProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrg } from '../cloud-org/profile-cloud-org-selection'
import {
  endVshuCloudSignInProgress,
  setVshuCloudSignInLink,
  startVshuCloudSignInProgress
} from './profile-cloud-sign-in-progress'
import { clearRelayRegionPreferenceCache } from '../../runtime/mobile-cloud-relay/region-selection/relay-region-preference'

import './profile-cloud-capability-refresh'
import {
  commitExchangedCloudSession,
  type CloudSessionCommitGuards
} from '../cloud-session/profile-cloud-session-commit'
import * as connectAttempts from './profile-cloud-connect-attempts'

function invalidateOutstandingCloudConnectAttempts(): number {
  const epoch = connectAttempts.supersedeCloudConnectAttempts()
  endVshuCloudSignInProgress()
  return epoch
}

export function getCurrentVshuProfileAuthStatus(userDataPath: string): VshuProfileAuthStatus {
  return getVshuProfileAuthStatusFromProfile(ensureActiveVshuProfile(userDataPath), userDataPath)
}

export async function connectCurrentVshuProfile(
  userDataPath: string,
  openBrowser: (url: string) => Promise<void>,
  mayCommit?: CloudSessionCommitGuards['mayCommit']
): Promise<ConnectCurrentVshuProfileResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    const list = connectDevVshuCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
    }
  }

  const attempt = connectAttempts.beginCloudConnectAttempt()
  const browserWait = new AbortController()
  startVshuCloudSignInProgress(attempt, () => browserWait.abort())
  let respondToBrowser: VshuCloudBrowserReturn['respond'] | undefined
  const finish = (result: ConnectCurrentVshuProfileResult): ConnectCurrentVshuProfileResult => {
    respondToBrowser?.(vshuCloudCallbackOutcomeOf(result))
    return result
  }
  try {
    const code = await beginVshuCloudPkceFlow(configState.config, active.profile.id, {
      openBrowser,
      signal: browserWait.signal,
      onAuthorizeUrl: (link) => setVshuCloudSignInLink(attempt, link)
    })
    respondToBrowser = code.respond
    // The browser came back, so its link is spent.
    setVshuCloudSignInLink(attempt, null)
    if (connectAttempts.isCloudConnectAttemptSuperseded(attempt)) {
      return finish({ status: 'cancelled', auth: getCurrentVshuProfileAuthStatus(userDataPath) })
    }
    const exchange = await exchangeVshuCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    const outcome = await commitExchangedCloudSession({
      config: configState.config,
      profileId: active.profile.id,
      userDataPath,
      attempt,
      exchange,
      guards: { mayCommit }
    })
    if (outcome.status === 'cancelled') {
      return finish({ status: 'cancelled', auth: getCurrentVshuProfileAuthStatus(userDataPath) })
    }
    if (outcome.status === 'refused') {
      return finish({
        status: 'failed',
        auth: getCurrentVshuProfileAuthStatus(userDataPath),
        error: outcome.error
      })
    }
    return finish({
      status: 'connected',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: outcome.list.activeProfileId,
      profiles: outcome.list.profiles
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message === 'vshu_cloud_auth_timeout' &&
      connectAttempts.isNewestCloudConnectAttempt(attempt)
    ) {
      return finish({ status: 'timed-out', auth: getCurrentVshuProfileAuthStatus(userDataPath) })
    }
    if (
      message === 'vshu_cloud_auth_timeout' ||
      message === 'vshu_cloud_auth_denied' ||
      message === 'vshu_cloud_auth_cancelled'
    ) {
      return finish({ status: 'cancelled', auth: getCurrentVshuProfileAuthStatus(userDataPath) })
    }
    return finish({
      status: 'failed',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      error: message
    })
  } finally {
    endVshuCloudSignInProgress(attempt)
  }
}

export async function signOutCurrentVshuProfile(
  userDataPath: string
): Promise<SignOutCurrentVshuProfileResult> {
  // Pending browser sign-ins must not relink after explicit sign-out.
  const signOutEpoch = invalidateOutstandingCloudConnectAttempts()
  const active = ensureActiveVshuProfile(userDataPath)
  const configState = getVshuCloudAuthConfig()
  const session = readCloudSession(active.profile.id, userDataPath)
  // Fence before network I/O so in-flight refreshes cannot save after sign-out.
  invalidateCloudSessionChanges(active.profile.id, userDataPath)
  if (!isVshuCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeVshuCloudSession(configState.config, session.session).catch(() => undefined)
  }
  if (connectAttempts.cloudConnectLinkEpoch() > signOutEpoch) {
    const current = ensureActiveVshuProfile(userDataPath)
    return {
      status: 'signed-out',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: current.index.activeProfileId,
      profiles: current.index.profiles
    }
  }
  signOutCloudSession(active.profile.id, userDataPath)
  const list = unlinkVshuProfileFromCloud(active.profile.id, userDataPath)
  try {
    clearRelayRegionPreferenceCache(userDataPath)
  } catch {
    // A leftover latency cache must not fail the sign-out itself.
  }
  return {
    status: 'signed-out',
    auth: getCurrentVshuProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedVshuProfile(
  userDataPath: string,
  args: CreateCloudLinkedVshuProfileArgs
): Promise<CreateCloudLinkedVshuProfileResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedVshuProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return {
        status: 'reconnect-required',
        auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
      }
    }
    return {
      status: 'created',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
    }
  }
  try {
    const operation = await runWithFreshVshuCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createVshuCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return {
        status: 'reconnect-required',
        auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
      }
    }
    const created = operation.value
    const list = createCloudLinkedVshuProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    signInCloudSession(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentVshuProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectVshuProfileOrgResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  if (isVshuCloudDevAuthEnabled()) {
    const result = selectDevVshuCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return {
        status: 'reconnect-required',
        auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
      }
    }
    return {
      status: 'selected',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getVshuCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
    }
  }
  try {
    const list = await selectCloudOrg({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return {
        status: 'reconnect-required',
        auth: getVshuProfileAuthStatusFromProfile(active, userDataPath)
      }
    }
    return {
      status: 'selected',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentVshuProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
