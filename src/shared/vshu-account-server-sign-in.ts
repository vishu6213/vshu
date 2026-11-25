import type { HostAccountSignInPhase } from './agent-accounts/host-account-sign-in-types'
import type { VshuCloudOrgSummary } from './vshu-profiles/vshu-profiles'

/** Where the host saves its sign-in; sign-in is refused unless it is sealed. */
export type VshuAccountStorage =
  | { kind: 'os-keychain' }
  /** Sealed with a key kept on the host; `warning` is shown at sign-in and in status. */
  | { kind: 'host-key'; warning: string }
  | { kind: 'refused'; reason: string }

/** The host's one Vshu account as it reports it to a client. */
export type VshuAccountServerStatus = {
  state: 'signed-in' | 'signed-out' | 'reconnect-required' | 'unconfigured'
  email?: string
  displayName?: string
  orgId?: string
  orgName?: string
  organizations?: VshuCloudOrgSummary[]
  /** When Vshu Cloud last confirmed the session (capability refresh), epoch ms. */
  lastConfirmedAt?: number
  /** Why the host signed out on its own, when it knows. */
  reason?: string
  storage: VshuAccountStorage
}

/** `switch-account` replaces a signed-in account; `sign-in` is refused while one is signed in. */
export type VshuAccountSignInIntent = 'sign-in' | 'switch-account'

export type VshuAccountMachinePlatform = 'macos' | 'linux' | 'windows'

/** Everything the client needs to build the authorize link; the verifier stays on the host. */
export type VshuAccountAuthorizeRequest = {
  authorizeEndpoint: string
  /** The client refuses when this is not its own Vshu Cloud, before spending the single-use code. */
  authorizeOrigin: string
  clientId: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  state: string
  nonce: string
  localProfileId: string
  machineLabel: string
  machinePlatform: VshuAccountMachinePlatform
  /** The page that shows a code to paste, for terminal and phone sign-ins. */
  hostedCodePageUrl: string
}

/** Approve in any browser: the person opens the link, checks the code matches, and approves;
 * the host learns of it from Vshu Cloud, so nothing is copied back. */
export type VshuAccountApprovalPrompt = {
  kind: 'approve-in-browser'
  verificationUrl: string
  /** Shown in the terminal and on the approval page, so the person can tell the two belong together. */
  userCode: string
  machineLabel: string
  expiresAt: number
}

export type VshuAccountSignInPrompt = VshuAccountAuthorizeRequest | VshuAccountApprovalPrompt

export function isVshuAccountApprovalPrompt(
  prompt: VshuAccountSignInPrompt | undefined
): prompt is VshuAccountApprovalPrompt {
  return prompt !== undefined && 'kind' in prompt && prompt.kind === 'approve-in-browser'
}

export type VshuAccountSignInStatus = {
  flowId: string
  provider: VshuAccountSignInIntent
  revision: number
  phase: HostAccountSignInPhase
  prompt?: VshuAccountSignInPrompt
  error?: string
  account?: VshuAccountServerStatus
}

export type VshuAccountSignInFrom = 'desktop' | 'terminal' | 'phone'

/** Whether a host's sign-in belongs to the Vshu Cloud this client signs in to. */
export function isSameVshuCloudOrigin(
  request: Pick<VshuAccountAuthorizeRequest, 'authorizeOrigin' | 'authorizeEndpoint'>,
  clientAuthorizeEndpoint: string
): boolean {
  try {
    const client = new URL(clientAuthorizeEndpoint).origin
    return (
      request.authorizeOrigin === client && new URL(request.authorizeEndpoint).origin === client
    )
  } catch {
    return false
  }
}

/** The client builds the link itself and never opens one a host sends. */
export function buildVshuAccountAuthorizeUrl(
  request: VshuAccountAuthorizeRequest,
  redirectUri: string,
  signInFrom: VshuAccountSignInFrom
): string {
  const url = new URL(request.authorizeEndpoint)
  url.searchParams.set('client_id', request.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', request.scope)
  url.searchParams.set('nonce', request.nonce)
  url.searchParams.set('state', request.state)
  url.searchParams.set('code_challenge', request.codeChallenge)
  url.searchParams.set('code_challenge_method', request.codeChallengeMethod)
  url.searchParams.set('local_profile_id', request.localProfileId)
  url.searchParams.set('machine_label', request.machineLabel)
  url.searchParams.set('machine_platform', request.machinePlatform)
  url.searchParams.set('sign_in_from', signInFrom)
  return url.toString()
}
