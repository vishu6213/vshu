import { createHash, randomBytes } from 'node:crypto'
import type { VshuCloudAuthConfig } from './profile-cloud-auth-config'
import { serveHeldLoopbackCallback } from './loopback-callback'
import {
  vshuCallbackReceivedPage,
  vshuCloudCallbackOutcome,
  type VshuCloudCallbackOutcome
} from './profile-cloud-callback-page'

export type VshuCloudAuthorizationCode = {
  code: string
  codeVerifier: string
  nonce: string
  redirectUri: string
  state: string
}

export type VshuCloudBrowserReturn = VshuCloudAuthorizationCode & {
  /** Ends the browser tab with the real outcome; only the first answer counts. */
  respond: (outcome: VshuCloudCallbackOutcome) => void
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000
const BROWSER_RESPONSE_TIMEOUT_MS = 45 * 1000

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function createCodeVerifier(): string {
  return base64Url(randomBytes(32))
}

function createCodeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

/** The secret half (verifier) stays with the host that redeems the code; the rest goes into the link. */
export function createVshuCloudPkceSecrets(): {
  codeVerifier: string
  codeChallenge: string
  nonce: string
  state: string
} {
  const codeVerifier = createCodeVerifier()
  return {
    codeVerifier,
    codeChallenge: createCodeChallenge(codeVerifier),
    nonce: base64Url(randomBytes(32)),
    state: base64Url(randomBytes(32))
  }
}

export function beginVshuCloudPkceFlow(
  config: VshuCloudAuthConfig,
  localProfileId: string,
  options: {
    openBrowser: (url: string) => Promise<void>
    onAuthorizeUrl?: (url: string) => void
    signal?: AbortSignal
  }
): Promise<VshuCloudBrowserReturn> {
  const { codeVerifier, codeChallenge, nonce, state } = createVshuCloudPkceSecrets()
  let redirectUri = ''

  const returned = serveHeldLoopbackCallback<VshuCloudAuthorizationCode>({
    path: '/auth/callback',
    timeoutMs: AUTH_TIMEOUT_MS,
    signal: options.signal,
    // The tab waits for the code exchange so it never claims a sign-in the app did not finish.
    hold: {
      received: vshuCallbackReceivedPage(),
      pending: vshuCloudCallbackOutcome({
        status: 'failed',
        error: 'vshu_cloud_auth_response_timeout'
      }),
      ms: BROWSER_RESPONSE_TIMEOUT_MS
    },
    errors: {
      timeout: 'vshu_cloud_auth_timeout',
      cancelled: 'vshu_cloud_auth_cancelled',
      unavailable: 'vshu_cloud_auth_loopback_unavailable',
      failed: 'vshu_cloud_auth_callback_failed'
    },
    read: (url) => {
      const invalid = { kind: 'stray', message: 'Invalid Vshu sign-in response.' } as const
      // Stray loopback probes must not cancel the user’s login.
      if (url.searchParams.get('state') !== state) {
        return invalid
      }
      if (url.searchParams.has('error')) {
        const cancelled = url.searchParams.get('error') === 'access_denied'
        return {
          kind: 'reject',
          message: cancelled
            ? 'Vshu sign-in was cancelled.'
            : 'Vshu sign-in failed. Return to Vshu and try again.',
          error: new Error(cancelled ? 'vshu_cloud_auth_denied' : 'vshu_cloud_auth_callback_failed')
        }
      }
      const code = url.searchParams.get('code')
      return code
        ? { kind: 'accept', value: { code, codeVerifier, nonce, redirectUri, state } }
        : invalid
    },
    onListening: async (port) => {
      redirectUri = `http://127.0.0.1:${port}/auth/callback`
      const authorizeUrl = new URL(config.authorizeEndpoint)
      authorizeUrl.searchParams.set('client_id', config.clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('scope', config.scope)
      authorizeUrl.searchParams.set('nonce', nonce)
      authorizeUrl.searchParams.set('state', state)
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('local_profile_id', localProfileId)
      options.onAuthorizeUrl?.(authorizeUrl.toString())
      try {
        await options.openBrowser(authorizeUrl.toString())
      } catch (error) {
        throw error instanceof Error ? error : new Error('vshu_cloud_auth_browser_open_failed')
      }
    }
  })
  return returned.then(({ value, answer }) => ({
    ...value,
    respond: (outcome) => answer(vshuCloudCallbackOutcome(outcome))
  }))
}
