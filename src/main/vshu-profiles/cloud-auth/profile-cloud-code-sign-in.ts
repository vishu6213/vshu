import type { ConnectCurrentVshuProfileResult } from '../../../shared/vshu-profiles/vshu-profiles'
import type { VshuCloudAuthConfig } from './profile-cloud-auth-config'
import { exchangeVshuCloudAuthCode } from './profile-cloud-client'
import { beginCloudConnectAttempt } from './profile-cloud-connect-attempts'
import type { VshuCloudAuthorizationCode } from './profile-cloud-pkce'
import { getCurrentVshuProfileAuthStatus } from './profile-cloud-service'
import {
  commitExchangedCloudSession,
  type CloudSessionCommitGuards
} from '../cloud-session/profile-cloud-session-commit'
import { ensureActiveVshuProfile } from '../profile-index-store'

/** Redeems a code whose browser leg ran on another device; the verifier never left this host. */
export async function signInCurrentVshuProfileWithCode(
  userDataPath: string,
  config: VshuCloudAuthConfig,
  code: VshuCloudAuthorizationCode,
  guards: CloudSessionCommitGuards = {}
): Promise<ConnectCurrentVshuProfileResult> {
  const active = ensureActiveVshuProfile(userDataPath)
  const attempt = beginCloudConnectAttempt()
  const auth = () => getCurrentVshuProfileAuthStatus(userDataPath)
  let exchange: Awaited<ReturnType<typeof exchangeVshuCloudAuthCode>>
  try {
    exchange = await exchangeVshuCloudAuthCode(config, {
      ...code,
      localProfileId: active.profile.id
    })
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
  const outcome = await commitExchangedCloudSession({
    config,
    profileId: active.profile.id,
    userDataPath,
    attempt,
    exchange,
    guards
  })
  if (outcome.status === 'cancelled') {
    return { status: 'cancelled', auth: auth() }
  }
  if (outcome.status === 'refused') {
    return { status: 'failed', auth: auth(), error: outcome.error }
  }
  return {
    status: 'connected',
    auth: auth(),
    activeProfileId: outcome.list.activeProfileId,
    profiles: outcome.list.profiles
  }
}
