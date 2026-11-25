import { resolve } from 'node:path'
import { build } from 'esbuild'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { calls, cloud, codeSignIn } = vi.hoisted(() => {
  const calls: string[] = []
  return {
    calls,
    codeSignIn: vi.fn(),
    cloud: {
      connectCurrentVshuProfile: vi.fn(),
      createCloudLinkedVshuProfile: vi.fn(),
      getCurrentVshuProfileAuthStatus: vi.fn(),
      refreshCurrentVshuProfileAuth: vi.fn(),
      selectCurrentVshuProfileOrg: vi.fn(),
      signOutCurrentVshuProfile: vi.fn()
    }
  }
})

vi.mock('./cloud-auth/profile-cloud-service', () => cloud)
vi.mock('./cloud-auth/profile-cloud-capability-refresh', () => ({
  refreshCurrentVshuProfileAuth: cloud.refreshCurrentVshuProfileAuth
}))
vi.mock('./cloud-auth/profile-cloud-code-sign-in', () => ({
  signInCurrentVshuProfileWithCode: codeSignIn
}))

import { type AccountBoundLinks, VshuAccountService } from './vshu-account-service'
import type { CloudSessionCommitGuards } from './cloud-session/profile-cloud-session-commit'
import type { VshuCloudAuthConfig } from './cloud-auth/profile-cloud-auth-config'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the code sign-in is mocked, so no endpoint is read.
const CONFIG = {} as VshuCloudAuthConfig
const CODE = { code: 'c', codeVerifier: 'v', nonce: 'n', redirectUri: 'https://x.test', state: 's' }

function serviceRecordingHooks(): VshuAccountService {
  return new VshuAccountService({
    openBrowser: async () => {},
    userDataPath: () => '/user-data',
    hooks: {
      onAuthMutation: () => calls.push('auth-mutation'),
      onBeforeSignOut: () => calls.push('before-sign-out'),
      onAfterSignOut: () => calls.push('after-sign-out')
    }
  })
}

describe('VshuAccountService', () => {
  beforeEach(() => {
    calls.length = 0
    for (const mock of Object.values(cloud)) {
      mock.mockReset()
    }
  })

  it('fences before sign-out and finishes after it, even when sign-out fails', async () => {
    cloud.signOutCurrentVshuProfile.mockImplementation(async () => {
      calls.push('sign-out')
      return { status: 'signed-out' }
    })
    const service = serviceRecordingHooks()

    await service.signOut()
    expect(calls).toEqual(['before-sign-out', 'sign-out', 'after-sign-out'])

    calls.length = 0
    cloud.signOutCurrentVshuProfile.mockImplementation(async () => {
      calls.push('sign-out')
      throw new Error('disk')
    })
    await expect(service.signOut()).rejects.toThrow('disk')
    expect(calls).toEqual(['before-sign-out', 'sign-out', 'after-sign-out'])
  })

  it('runs the auth-mutation hook only when an account change succeeded', async () => {
    const service = serviceRecordingHooks()
    cloud.connectCurrentVshuProfile.mockResolvedValueOnce({ status: 'connected' })
    cloud.connectCurrentVshuProfile.mockResolvedValueOnce({ status: 'cancelled' })
    cloud.refreshCurrentVshuProfileAuth.mockResolvedValueOnce({ status: 'refreshed' })
    cloud.refreshCurrentVshuProfileAuth.mockResolvedValueOnce({ status: 'reconnect-required' })
    cloud.selectCurrentVshuProfileOrg.mockResolvedValueOnce({ status: 'selected' })
    cloud.selectCurrentVshuProfileOrg.mockResolvedValueOnce({ status: 'failed' })

    await service.connect()
    await service.connect()
    await service.refreshAuth()
    await service.refreshAuth()
    await service.selectOrg('org-1')
    await service.selectOrg('org-1')

    expect(calls).toEqual(['auth-mutation', 'auth-mutation', 'auth-mutation'])
    expect(cloud.selectCurrentVshuProfileOrg).toHaveBeenCalledWith('/user-data', 'org-1')
  })

  it('runs per-profile setup before the auth-mutation hook on create', async () => {
    cloud.createCloudLinkedVshuProfile.mockResolvedValue({
      status: 'created',
      profile: { id: 'cloud-1' }
    })
    const service = serviceRecordingHooks()

    await service.createCloudLinked({ name: 'Acme' }, (profileId) =>
      calls.push(`created:${profileId}`)
    )

    expect(calls).toEqual(['created:cloud-1', 'auth-mutation'])
  })

  it('hands its browser opener to the sign-in flow', async () => {
    const openBrowser = vi.fn(async () => {})
    cloud.connectCurrentVshuProfile.mockResolvedValue({ status: 'unconfigured' })

    await new VshuAccountService({ openBrowser, userDataPath: () => '/u' }).connect()

    expect(cloud.connectCurrentVshuProfile).toHaveBeenCalledWith(
      '/u',
      openBrowser,
      expect.any(Function)
    )
  })

  describe('ownership of links other features made under the account (D5)', () => {
    let links: AccountBoundLinks
    let refusal: ReturnType<typeof vi.fn<AccountBoundLinks['refusal']>>
    let processProfileId = 'profile-1'

    beforeEach(() => {
      processProfileId = 'profile-1'
      refusal = vi.fn((nextUserId: string, profileUserId: string | null) =>
        nextUserId === (profileUserId ?? 'user-a') ? null : 'Remove these connectors first: Helper.'
      )
      links = { profileId: () => processProfileId, refusal }
      codeSignIn.mockReset()
      codeSignIn.mockResolvedValue({ status: 'failed', error: 'stub' })
    })

    function service(): VshuAccountService {
      return new VshuAccountService({
        openBrowser: async () => {},
        userDataPath: () => '/user-data',
        accountBoundLinks: links
      })
    }

    function signedInAs(userId: string | null) {
      cloud.getCurrentVshuProfileAuthStatus.mockReturnValue({
        activeProfileId: 'profile-1',
        ...(userId ? { cloud: { userId } } : {})
      })
    }

    async function guardFor(account: VshuAccountService): Promise<CloudSessionCommitGuards> {
      await account.signInWithCode(CONFIG, CODE, { requireSealedStorage: true })
      const guards: CloudSessionCommitGuards | undefined = codeSignIn.mock.lastCall?.[3]
      if (!guards?.mayCommit) {
        throw new Error('no commit guard')
      }
      return guards
    }

    const toB = { profileId: 'profile-1', nextUserId: 'user-b', currentUserId: 'user-a' }

    it("asks the links about the captured profile's own account, not whichever profile is active", async () => {
      signedInAs('user-b')
      const guards = await guardFor(service())

      expect(guards.requireSealedStorage).toBe(true)
      expect(guards.mayCommit?.(toB)).toBe('Remove these connectors first: Helper.')
      expect(refusal).toHaveBeenLastCalledWith('user-b', 'user-a')
      expect(guards.mayCommit?.({ ...toB, nextUserId: 'user-a' })).toBeNull()
    })

    it('refuses an account change for a profile other than the one whose links it read', async () => {
      const guards = await guardFor(service())
      processProfileId = 'profile-2'

      expect(guards.mayCommit?.({ ...toB, nextUserId: 'user-a' })).toBe(
        'The Vshu profile changed during sign-in. Try again.'
      )
    })

    it('still signs out when the account status cannot be read', async () => {
      cloud.getCurrentVshuProfileAuthStatus.mockImplementation(() => {
        throw new Error('EIO: profile index unreadable')
      })
      cloud.signOutCurrentVshuProfile.mockResolvedValue({ status: 'signed-out' })
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(service().signOut()).resolves.toEqual({ status: 'signed-out' })
    })

    it('applies the same guard to the desktop window sign-in', async () => {
      cloud.connectCurrentVshuProfile.mockResolvedValue({ status: 'failed' })
      await service().connect()
      const mayCommit: CloudSessionCommitGuards['mayCommit'] =
        cloud.connectCurrentVshuProfile.mock.lastCall?.[2]

      expect(mayCommit?.(toB)).toBe('Remove these connectors first: Helper.')
      expect(mayCommit?.({ ...toB, nextUserId: 'user-a' })).toBeNull()
    })
  })

  // esbuild walks the whole cloud sign-in graph, which can outlast the default on a cold cache.
  it('bundles for a plain-Node host without importing Electron', async () => {
    const result = await build({
      entryPoints: [resolve(__dirname, 'vshu-account-service.ts')],
      bundle: true,
      write: false,
      outdir: 'out',
      platform: 'node',
      format: 'esm',
      target: 'node22',
      packages: 'external',
      metafile: true,
      logLevel: 'silent'
    })
    const imports = Object.values(result.metafile.outputs).flatMap((output) =>
      output.imports.map((entry) => entry.path)
    )
    expect(imports.filter((path) => path === 'electron' || path.startsWith('electron/'))).toEqual(
      []
    )
  }, 60_000)
})
