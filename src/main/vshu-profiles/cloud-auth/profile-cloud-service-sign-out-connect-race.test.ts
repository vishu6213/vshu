import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  VshuCloudCapabilities,
  VshuCloudOrgSummary,
  VshuProfileCloudSummary
} from '../../../shared/vshu-profiles/vshu-profiles'

const {
  beginVshuCloudPkceFlowMock,
  exchangeVshuCloudAuthCodeMock,
  revokeVshuCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginVshuCloudPkceFlowMock: vi.fn(),
  exchangeVshuCloudAuthCodeMock: vi.fn(),
  revokeVshuCloudSessionMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginVshuCloudPkceFlow: beginVshuCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createVshuCloudProfile: vi.fn(),
  exchangeVshuCloudAuthCode: exchangeVshuCloudAuthCodeMock,
  revokeVshuCloudSession: revokeVshuCloudSessionMock,
  selectVshuCloudOrg: vi.fn()
}))

import {
  connectCurrentVshuProfile,
  getCurrentVshuProfileAuthStatus,
  signOutCurrentVshuProfile
} from './profile-cloud-service'

// The PKCE flow is mocked, so no browser opens.
const openNoBrowser = async (): Promise<void> => {}

const cloud: VshuProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: VshuProfileCloudSummary = {
  ...cloud,
  cloudProfileId: 'cloud-profile-2',
  email: 'ada@example.com'
}

const capabilities: VshuCloudCapabilities = { flags: { share: true }, refreshedAt: 11 }
const organizations: VshuCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

describe('Vshu cloud sign-out vs newer connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'vshu-cloud-sign-out-connect-'))
    beginVshuCloudPkceFlowMock.mockReset()
    exchangeVshuCloudAuthCodeMock.mockReset()
    revokeVshuCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('VSHU_CLOUD_API_URL', 'https://vshu-cloud.example')
    vi.stubEnv('VSHU_CLOUD_CLIENT_ID', 'desktop-client')
    beginVshuCloudPkceFlowMock.mockResolvedValue({
      code: 'auth-code',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectUri: 'http://127.0.0.1:4100/auth/callback',
      state: 'state'
    })
    exchangeVshuCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      cloud,
      organizations,
      capabilities
    })
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('keeps a newer connect that finishes while sign-out is still revoking', async () => {
    await expect(connectCurrentVshuProfile(userDataPath, openNoBrowser)).resolves.toMatchObject({
      status: 'connected'
    })
    let finishRevoke!: () => void
    revokeVshuCloudSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRevoke = resolve
      })
    )
    const signingOut = signOutCurrentVshuProfile(userDataPath)
    exchangeVshuCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'later-access',
      refreshToken: 'later-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: laterCloud,
      organizations,
      capabilities
    })
    await expect(connectCurrentVshuProfile(userDataPath, openNoBrowser)).resolves.toMatchObject({
      status: 'connected'
    })
    expect(getCurrentVshuProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
    finishRevoke()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed-out' })
    expect(getCurrentVshuProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      cloud: { email: 'ada@example.com' }
    })
  })
})
