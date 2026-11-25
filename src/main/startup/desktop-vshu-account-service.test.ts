import { beforeEach, describe, expect, it, vi } from 'vitest'

const { calls, connector, signOutCurrentVshuProfile, state } = vi.hoisted(() => {
  const calls: string[] = []
  const bots = { list: () => [] }
  return {
    calls,
    connector: {
      accountChanged: () => calls.push('connector-account-changed'),
      signOutStarted: () => calls.push('connector-sign-out-started'),
      signOutFinished: () => calls.push('connector-sign-out-finished')
    },
    bots,
    signOutCurrentVshuProfile: vi.fn(async () => {
      calls.push('revoke-and-clear')
      return { status: 'signed-out' }
    }),
    state: {
      activeVshuProfile: { profile: { id: 'profile-1' } },
      runtime: { bots },
      relayHost: {
        signOutStarted: () => calls.push('relay-sign-out-started'),
        accountChanged: () => calls.push('relay-account-changed')
      }
    }
  }
})

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('./main-process-state', () => ({ mainProcessState: state }))
vi.mock('./cloud-startup/main-process-connector-startup', () => ({
  mainProcessConnectorCloud: () => connector
}))
vi.mock('../vshu-profiles/cloud-auth/profile-cloud-service', () => ({
  signOutCurrentVshuProfile,
  getCurrentVshuProfileAuthStatus: () => ({
    activeProfileId: 'profile-1',
    cloud: { userId: 'user-a' }
  }),
  connectCurrentVshuProfile: vi.fn(async () => ({ status: 'connected' }))
}))

import { createDesktopVshuAccountService } from './desktop-vshu-account-service'

describe('desktop Vshu account service', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('fences the relay and connector before revoking, then finishes the connector', async () => {
    await createDesktopVshuAccountService().signOut()

    expect(calls).toEqual([
      'relay-sign-out-started',
      'connector-sign-out-started',
      'revoke-and-clear',
      'connector-sign-out-finished'
    ])
  })

  it('retries the relay and tells the connector after a sign-in', async () => {
    await createDesktopVshuAccountService().connect()

    expect(calls).toEqual(['relay-account-changed', 'connector-account-changed'])
  })
})
