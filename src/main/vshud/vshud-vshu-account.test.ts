import { afterEach, describe, expect, it } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { flushUnsavedCloudSessions } from '../vshu-profiles/cloud-session/profile-cloud-session-owner'
import { getVshuServerSignIn, installVshuServerSignIn } from '../vshu-profiles/vshu-server-sign-in'
import type { BackendServiceCleanup } from '../backend/service-composition'
import { installVshudVshuAccount } from './vshud-vshu-account'

afterEach(() => installVshuServerSignIn(null))

describe('installVshudVshuAccount', () => {
  it('installs the account sign-in, flushes unsaved rotations on SIGTERM, and uninstalls on cleanup', async () => {
    const quitHandlers: (() => void)[] = []
    installFakeAppEnvironment({ onWillQuit: (handler) => quitHandlers.push(handler) })
    const cleanups: BackendServiceCleanup[] = []

    const served: string[] = []
    installVshudVshuAccount(
      {
        bots: { list: () => [] },
        serveVshuProfile: (id) => served.push(id),
        getConnectorCloud: () => null
      },
      { accountChanged: () => {}, signOutStarted: () => {} },
      (cleanup) => cleanups.push(cleanup),
      'profile-1'
    )

    expect(served).toEqual(['profile-1'])

    expect(getVshuServerSignIn()).not.toBeNull()
    expect(quitHandlers).toContain(flushUnsavedCloudSessions)
    for (const cleanup of cleanups) {
      await cleanup({ failed: false })
    }
    expect(getVshuServerSignIn()).toBeNull()
  })

  it("stops this server's relay and connector when it signs out, and lets them resume after", async () => {
    const calls: string[] = []
    const connector = {
      accountChanged: () => calls.push('accountChanged'),
      signOutStarted: () => calls.push('signOutStarted'),
      signOutFinished: () => calls.push('signOutFinished')
    }
    installVshudVshuAccount(
      {
        bots: { list: () => [] },
        serveVshuProfile: () => {},
        getConnectorCloud: () => connector
      },
      {
        accountChanged: () => calls.push('relay.accountChanged'),
        signOutStarted: () => calls.push('relay.signOutStarted')
      },
      () => {},
      null
    )

    await getVshuServerSignIn()!.signOut()

    expect(calls).toEqual(['relay.signOutStarted', 'signOutStarted', 'signOutFinished'])
  })
})
