import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VshuCloudAuthConfig } from './profile-cloud-auth-config'

const { calls, client, owner } = vi.hoisted(() => {
  const calls: string[] = []
  return {
    calls,
    client: {
      exchangeVshuCloudAuthCode: vi.fn(),
      revokeVshuCloudSession: vi.fn(async (_config: unknown, session: { refreshToken: string }) => {
        calls.push(`revoke:${session.refreshToken}`)
      })
    },
    owner: {
      readCloudSession: vi.fn(),
      sessionFromExchange: (exchange: { refreshToken: string }) => exchange,
      signInCloudSession: vi.fn(
        (_profileId: string, _path: string, exchange: { refreshToken: string }) => {
          calls.push(`save:${exchange.refreshToken}`)
        }
      )
    }
  }
})

vi.mock('./profile-cloud-client', () => client)
vi.mock('../cloud-session/profile-cloud-session-owner', () => owner)
vi.mock('./profile-cloud-index', () => ({
  linkVshuProfileToCloud: () => ({ activeProfileId: 'profile-1', profiles: [] })
}))
vi.mock('../profile-index-store', () => ({
  ensureActiveVshuProfile: () => ({ profile: { id: 'profile-1' } }),
  loadOrCreateProfileIndex: () => ({ profiles: [{ id: 'profile-1' }] })
}))
vi.mock('./profile-cloud-service', () => ({
  getCurrentVshuProfileAuthStatus: () => ({ activeProfileId: 'profile-1' })
}))

import { signInCurrentVshuProfileWithCode } from './profile-cloud-code-sign-in'

const config = {
  sessionEndpoint: 'https://login.example.test/v1/desktop/auth/session'
} satisfies Partial<VshuCloudAuthConfig>
const code = {
  code: 'one-time',
  codeVerifier: 'verifier',
  nonce: 'nonce',
  redirectUri: 'https://login.example.test/v1/desktop/auth/server-sign-in/code',
  state: 'state'
}

function signIn() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the client that reads the config is mocked.
  return signInCurrentVshuProfileWithCode('/user-data', config as VshuCloudAuthConfig, code)
}

describe('signInCurrentVshuProfileWithCode', () => {
  beforeEach(() => {
    calls.length = 0
    client.exchangeVshuCloudAuthCode.mockReset()
    owner.readCloudSession.mockReset()
  })

  it('revokes the account it replaces only after the new session is saved', async () => {
    client.exchangeVshuCloudAuthCode.mockResolvedValue({ refreshToken: 'new', cloud: {} })
    owner.readCloudSession.mockReturnValue({
      status: 'found',
      session: { refreshToken: 'old' }
    })

    await expect(signIn()).resolves.toMatchObject({ status: 'connected' })

    expect(calls).toEqual(['save:new', 'revoke:old'])
  })

  it('keeps the signed-in account when the code is refused', async () => {
    client.exchangeVshuCloudAuthCode.mockRejectedValue(new Error('vshu_cloud_request_failed_400'))

    await expect(signIn()).resolves.toMatchObject({
      status: 'failed',
      error: 'vshu_cloud_request_failed_400'
    })

    expect(calls).toEqual([])
  })
})
