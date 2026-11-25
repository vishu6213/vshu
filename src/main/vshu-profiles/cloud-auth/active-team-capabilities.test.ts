import { expect, it, vi } from 'vitest'
import { createDefaultLocalVshuProfile } from '../../../shared/vshu-profiles/vshu-profiles'
import {
  isVshuCloudTeamFeatureBlocked,
  VSHU_CLOUD_TEAM_POLICY_FLAGS as flags
} from '../../../shared/vshu-profiles/vshu-cloud-team-policy'
import {
  initializeActiveTeamProfile,
  isTeamFeatureBlocked,
  observeActiveTeamProfile,
  observeActiveTeamSession
} from './active-team-capabilities'
import type { VshuAccountService } from '../vshu-account-service'
import { scheduleTeamPolicyRefresh } from './team-policy-refresh'

it('keeps membership policy on the personal account without carrying it across account identities', () => {
  const cloud = {
    userId: 'user_a',
    cloudProfileId: 'cloud_a',
    email: 'a@example.test',
    linkedAt: 1
  }
  const profile = { ...createDefaultLocalVshuProfile(1), cloud }
  const capabilities = {
    flags: { team_settings: true, 'relay.use': false },
    teamPolicy: { orgIds: ['org_a'] },
    refreshedAt: 1
  }
  const finish = initializeActiveTeamProfile('/vshu', {
    ...profile,
    cloud: { ...cloud, activeOrgId: 'org_a' }
  })
  finish({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 2,
    identity: cloud,
    capabilities
  })

  observeActiveTeamProfile('/vshu', profile)
  expect(isTeamFeatureBlocked(flags.mobileRelay)).toBe(true)
  expect(
    isVshuCloudTeamFeatureBlocked(
      {
        activeProfileId: profile.id,
        configured: true,
        state: 'connected',
        persistence: 'encrypted',
        cloud,
        capabilities
      },
      flags.mobileRelay
    )
  ).toBe(true)

  observeActiveTeamProfile('/vshu', { ...profile, cloud: { ...cloud, userId: 'user_b' } })
  expect(isTeamFeatureBlocked(flags.mobileRelay)).toBe(false)
})

it('discovers new policies on a connected account and cancels discovery at sign-out', async () => {
  vi.useFakeTimers()
  const cloud = {
    userId: 'user_a',
    cloudProfileId: 'cloud_a',
    email: 'a@example.test',
    linkedAt: 1
  }
  const profile = { ...createDefaultLocalVshuProfile(1), cloud }
  const connect = initializeActiveTeamProfile('/vshu', profile)
  const session = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 2,
    identity: cloud,
    capabilities: { flags: {}, refreshedAt: 1 },
    organizations: [{ orgId: 'org_a', name: 'Acme' }]
  }
  const governed = {
    flags: { team_settings: true, 'relay.use': false },
    teamPolicy: { orgIds: ['org_a'] },
    refreshedAt: 2
  }
  const refreshAuth = vi.fn<VshuAccountService['refreshAuth']>().mockImplementation(async () => {
    observeActiveTeamSession('/vshu', profile.id, { ...session, capabilities: governed })
    return {
      status: 'refreshed',
      activeProfileId: profile.id,
      profiles: [profile],
      auth: {
        activeProfileId: profile.id,
        configured: true,
        state: 'connected',
        persistence: 'encrypted',
        cloud,
        capabilities: governed
      }
    }
  })
  const stop = scheduleTeamPolicyRefresh({ refreshAuth })
  try {
    connect(session)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(isTeamFeatureBlocked(flags.mobileRelay)).toBe(true)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(refreshAuth).toHaveBeenCalledTimes(2)

    observeActiveTeamSession('/vshu', profile.id, undefined)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(refreshAuth).toHaveBeenCalledTimes(2)
  } finally {
    stop()
    vi.useRealTimers()
  }
})
