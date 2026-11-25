import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { botAccountSwitchBlocker } from '../bots/bot-account-switch-blocker'
import { VshuAccountService } from '../vshu-profiles/vshu-account-service'
import { flushUnsavedCloudSessions } from '../vshu-profiles/cloud-session/profile-cloud-session-owner'
import { installVshuServerSignIn, VshuServerSignIn } from '../vshu-profiles/vshu-server-sign-in'
import { GoogleConnect, installGoogleConnect } from '../google/google-connect'
import type { BotController } from '../bots/bot-controller'
import type { ConnectorCloud } from '../connector-cloud/connector-cloud'
import type { VshudRelay } from './vshud-relay'
import type { BackendServiceCleanup } from '../backend/service-composition'
import { vshudServedProfileId } from './vshud-served-profile'
import type * as VshudConnector from './vshud-connector'

/** The daemon's relay host and its Vshu account, which signs the relay in and out. */
export async function installVshudRelayAndAccount(
  runtime: Parameters<typeof installVshudVshuAccount>[0],
  registerCleanup: (cleanup: BackendServiceCleanup) => void
): Promise<VshudRelay> {
  const { createVshudRelay } = await import('./vshud-relay')
  const relay = createVshudRelay(registerCleanup)
  installVshudVshuAccount(runtime, relay, registerCleanup)
  return relay
}

/** The daemon's connector host, loaded on first use like its relay. */
export async function installVshudConnectorHost(
  ...args: Parameters<typeof VshudConnector.installVshudConnector>
): Promise<ReturnType<typeof VshudConnector.installVshudConnector>> {
  const { installVshudConnector } = await import('./vshud-connector')
  return installVshudConnector(...args)
}

/** vshud's Vshu account: signed in only through a client that relays the code, never a browser here. */
export function installVshudVshuAccount(
  runtime: {
    bots: Pick<BotController, 'list'>
    serveVshuProfile: (profileId: string) => void
    getConnectorCloud: () => Pick<
      ConnectorCloud,
      'accountChanged' | 'signOutStarted' | 'signOutFinished'
    > | null
  },
  relay: Pick<VshudRelay, 'accountChanged' | 'signOutStarted'>,
  registerCleanup: (cleanup: BackendServiceCleanup) => void,
  /** The profile vshud serves, chosen at startup. */
  profileId = vshudServedProfileId()
): void {
  if (profileId) {
    runtime.serveVshuProfile(profileId)
  }
  const account = new VshuAccountService({
    openBrowser: async () => {
      throw new Error(
        'This server has no browser. Sign it in from a paired client or `vshu auth login`.'
      )
    },
    accountBoundLinks: botAccountSwitchBlocker({
      bots: () => runtime.bots,
      profileId: () => profileId
    }),
    // A sign-out or switch on this server stops its relay and connector at once, as on the desktop.
    hooks: {
      onAuthMutation: () => {
        relay.accountChanged()
        runtime.getConnectorCloud()?.accountChanged()
      },
      onBeforeSignOut: () => {
        relay.signOutStarted()
        runtime.getConnectorCloud()?.signOutStarted()
      },
      onAfterSignOut: () => runtime.getConnectorCloud()?.signOutFinished()
    }
  })
  const server = new VshuServerSignIn({ account })
  installVshuServerSignIn(server)
  server.startDailyRefresh()
  // A rotation saved only in memory would be replayed after restart and end the session family.
  getAppEnvironment().onWillQuit(flushUnsavedCloudSessions)
  registerCleanup(() => installVshuServerSignIn(null))
  // No browser here: Google sign-in prints its link and takes the pasted address, or a paired desktop's.
  installGoogleConnect(new GoogleConnect())
  registerCleanup(() => installGoogleConnect(null))
}
