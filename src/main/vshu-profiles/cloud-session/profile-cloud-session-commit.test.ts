import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSecretStore, type SecretSealing } from '../../../shared/secure-storage/secret-store'
import type { VshuCloudAuthConfig } from '../cloud-auth/profile-cloud-auth-config'
import type { VshuCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import type { ActiveVshuProfileState } from '../profile-index-store'
import type * as ProfileCloudClient from '../cloud-auth/profile-cloud-client'
import type * as ArtifactCloudCleanup from '../cloud-auth/profile-artifact-cloud-cleanup'

const { client, cleanup } = vi.hoisted(() => ({
  client: {
    revokeVshuCloudSession: vi.fn(
      async (_config: unknown, _session: { refreshToken: string }) => {}
    )
  },
  // Linking writes the profile index between these two cleanup steps.
  cleanup: { failBeforeIndex: false, failAfterIndex: false }
}))

vi.mock('../cloud-auth/profile-cloud-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileCloudClient>()),
  revokeVshuCloudSession: client.revokeVshuCloudSession
}))
vi.mock('../cloud-auth/profile-artifact-cloud-cleanup', async (importOriginal) => {
  const real = await importOriginal<typeof ArtifactCloudCleanup>()
  const failing = (when: 'failBeforeIndex' | 'failAfterIndex') => () => {
    if (cleanup[when]) {
      throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
    }
  }
  return {
    ...real,
    prepareArtifactCloudCleanup: (...args: Parameters<typeof real.prepareArtifactCloudCleanup>) => {
      failing('failBeforeIndex')()
      real.prepareArtifactCloudCleanup(...args)
    },
    commitArtifactCloudCleanup: (...args: Parameters<typeof real.commitArtifactCloudCleanup>) => {
      failing('failAfterIndex')()
      real.commitArtifactCloudCleanup(...args)
    }
  }
})

import { commitExchangedCloudSession } from './profile-cloud-session-commit'
import {
  beginCloudConnectAttempt,
  supersedeCloudConnectAttempts
} from '../cloud-auth/profile-cloud-connect-attempts'
import { linkVshuProfileToCloud } from '../cloud-auth/profile-cloud-index'
import { readCloudSession, signInCloudSession } from './profile-cloud-session-owner'
import { readFreshVshuCloudSession } from './profile-cloud-session-refresh'
import { saveVshuCloudSession } from './profile-cloud-session-store'
import { ensureActiveVshuProfile } from '../profile-index-store'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: revoke is mocked; nothing reads an endpoint.
const config = {} as VshuCloudAuthConfig

function exchangeFor(userId: string, refreshToken: string): VshuCloudSessionExchangeResponse {
  return {
    accessToken: `access-${refreshToken}`,
    refreshToken,
    // Far future: these tests never refresh.
    expiresAt: 4_000_000_000_000,
    organizations: [],
    capabilities: { flags: {}, refreshedAt: 1 },
    cloud: { userId, cloudProfileId: `cp-${userId}`, email: `${userId}@example.test`, linkedAt: 1 }
  }
}

function installSealing(sealing: SecretSealing, available = sealing.kind !== 'none'): void {
  setSecretStore({
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (cipher) => cipher.toString().slice('sealed:'.length),
    describeProtectionGap: () => null,
    describeSealing: () => sealing
  })
}

let userDataPath = ''
let profileId = ''

function commit(
  exchange: VshuCloudSessionExchangeResponse,
  guards: Parameters<typeof commitExchangedCloudSession>[0]['guards'] = {},
  attempt = beginCloudConnectAttempt()
) {
  return commitExchangedCloudSession({
    config,
    profileId,
    userDataPath,
    attempt,
    exchange,
    guards
  })
}

function storedRefreshToken(): string | null {
  const stored = readCloudSession(profileId, userDataPath)
  return stored.status === 'found' ? stored.session.refreshToken : null
}

async function revokedTokens(): Promise<string[]> {
  await new Promise((resolve) => setImmediate(resolve))
  return client.revokeVshuCloudSession.mock.calls.map(([, session]) => session.refreshToken)
}

function signInAs(exchange: VshuCloudSessionExchangeResponse): void {
  signInCloudSession(profileId, userDataPath, exchange)
  linkVshuProfileToCloud(profileId, exchange.cloud, userDataPath)
}

function linkedUserId(): string | undefined {
  return ensureActiveVshuProfile(userDataPath).profile.cloud?.userId
}

describe('commitExchangedCloudSession', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'vshu-session-commit-'))
    installSealing({ kind: 'os-keychain' })
    client.revokeVshuCloudSession.mockReset()
    client.revokeVshuCloudSession.mockResolvedValue(undefined)
    cleanup.failBeforeIndex = false
    cleanup.failAfterIndex = false
    profileId = ensureActiveVshuProfile(userDataPath).profile.id
    signInAs(exchangeFor('user-a', 'a-token'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('switches accounts, stamps the new identity and revokes the replaced session', async () => {
    await expect(commit(exchangeFor('user-b', 'b-token'))).resolves.toMatchObject({
      status: 'committed'
    })

    const stored = readCloudSession(profileId, userDataPath)
    expect(linkedUserId()).toBe('user-b')
    expect(stored.status === 'found' && stored.session.identity).toEqual({
      userId: 'user-b',
      cloudProfileId: 'cp-user-b'
    })
    expect(await revokedTokens()).toEqual(['a-token'])
  })

  it('keeps the old account and revokes the new session when linking fails before the index changes', async () => {
    cleanup.failBeforeIndex = true

    await expect(commit(exchangeFor('user-b', 'b-token'))).resolves.toEqual({
      status: 'refused',
      error: 'EIO: i/o error'
    })

    expect(linkedUserId()).toBe('user-a')
    expect(storedRefreshToken()).toBe('a-token')
    expect(await revokedTokens()).toEqual(['b-token'])
  })

  it('finishes the change when linking fails after the index names the new account', async () => {
    cleanup.failAfterIndex = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(commit(exchangeFor('user-b', 'b-token'))).resolves.toMatchObject({
      status: 'committed'
    })

    expect(linkedUserId()).toBe('user-b')
    expect(storedRefreshToken()).toBe('b-token')
    expect(await revokedTokens()).toEqual(['a-token'])
    const active = ensureActiveVshuProfile(userDataPath)
    await expect(readFreshVshuCloudSession(config, active, userDataPath)).resolves.toMatchObject({
      status: 'found',
      session: { refreshToken: 'b-token' }
    })
  })

  it('restores a pre-upgrade session under its own account, never as the new one', async () => {
    // Saved before sessions carried an identity.
    const legacy = exchangeFor('user-a', 'legacy-a')
    saveVshuCloudSession(profileId, userDataPath, {
      accessToken: legacy.accessToken,
      refreshToken: legacy.refreshToken,
      expiresAt: legacy.expiresAt,
      organizations: [],
      capabilities: legacy.capabilities
    })
    cleanup.failBeforeIndex = true

    await expect(commit(exchangeFor('user-b', 'b-token'))).resolves.toMatchObject({
      status: 'refused'
    })

    const restored = readCloudSession(profileId, userDataPath)
    expect(restored.status === 'found' && restored.session).toMatchObject({
      refreshToken: 'legacy-a',
      identity: { userId: 'user-a', cloudProfileId: 'cp-user-a' }
    })
  })

  it('revokes the new session when the ownership guard itself throws', async () => {
    const mayCommit = vi.fn((): string | null => {
      throw Object.assign(new Error('EIO: profile index unreadable'), { code: 'EIO' })
    })

    await expect(commit(exchangeFor('user-b', 'b-token'), { mayCommit })).resolves.toEqual({
      status: 'refused',
      error: 'EIO: profile index unreadable'
    })
    expect(storedRefreshToken()).toBe('a-token')
    expect(await revokedTokens()).toEqual(['b-token'])
  })

  it('never uses a session stamped for a user other than the one the profile is linked to', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fresh-session read uses only profile.id and profile.cloud.
    const active = {
      profile: {
        id: profileId,
        cloud: { userId: 'user-b', cloudProfileId: 'cp-user-b', email: 'b@x', linkedAt: 1 }
      }
    } as unknown as ActiveVshuProfileState

    await expect(readFreshVshuCloudSession(config, active, userDataPath)).resolves.toEqual({
      status: 'reconnect-required'
    })
  })

  it('refuses unsealed storage for a strict commit and keeps the old account', async () => {
    installSealing({ kind: 'none', reason: 'the keyring uses basic_text.' }, true)

    await expect(
      commit(exchangeFor('user-b', 'b-token'), { requireSealedStorage: true })
    ).resolves.toEqual({
      status: 'refused',
      error: "Vshu can't save your sign-in on this host: the keyring uses basic_text."
    })
    expect(await revokedTokens()).toEqual(['b-token'])
    expect(linkedUserId()).toBe('user-a')
  })

  it('refuses a strict commit that would only be kept in memory', async () => {
    installSealing({ kind: 'os-keychain' }, false)

    await expect(
      commit(exchangeFor('user-b', 'b-token'), { requireSealedStorage: true })
    ).resolves.toMatchObject({ status: 'refused' })
    expect(await revokedTokens()).toEqual(['b-token'])
  })

  it('still lets the desktop keep a memory-only session when no seal is required', async () => {
    installSealing({ kind: 'os-keychain' }, false)

    await expect(commit(exchangeFor('user-a', 'a2-token'))).resolves.toMatchObject({
      status: 'committed'
    })
    expect(readCloudSession(profileId, userDataPath)).toMatchObject({
      status: 'found',
      persistence: 'memory-only'
    })
  })

  it('drops an exchange the person cancelled, keeping the old account and revoking the new one', async () => {
    const cancelled = new AbortController()
    cancelled.abort()

    await expect(
      commit(exchangeFor('user-b', 'b-token'), { signal: cancelled.signal })
    ).resolves.toEqual({ status: 'cancelled' })
    expect(storedRefreshToken()).toBe('a-token')
    expect(await revokedTokens()).toEqual(['b-token'])
  })

  it('drops an exchange a sign-out superseded, and survives a failing revoke', async () => {
    const attempt = beginCloudConnectAttempt()
    supersedeCloudConnectAttempts()
    client.revokeVshuCloudSession.mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(commit(exchangeFor('user-b', 'b-token'), {}, attempt)).resolves.toEqual({
      status: 'cancelled'
    })
    expect(await revokedTokens()).toEqual(['b-token'])
    expect(warn).toHaveBeenCalledWith('[vshu-account] Could not revoke an unused sign-in')
  })

  it('lets the ownership guard refuse a different account before anything is saved', async () => {
    const mayCommit = vi.fn(({ nextUserId }: { nextUserId: string }) =>
      nextUserId === 'user-a' ? null : 'Links belong to A.'
    )

    await expect(commit(exchangeFor('user-b', 'b-token'), { mayCommit })).resolves.toEqual({
      status: 'refused',
      error: 'Links belong to A.'
    })
    expect(storedRefreshToken()).toBe('a-token')
    expect(mayCommit).toHaveBeenCalledWith({
      profileId,
      nextUserId: 'user-b',
      currentUserId: 'user-a'
    })
    await expect(commit(exchangeFor('user-a', 'a2-token'), { mayCommit })).resolves.toMatchObject({
      status: 'committed'
    })
  })
})
