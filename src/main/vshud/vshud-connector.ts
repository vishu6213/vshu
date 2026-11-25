import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { installConnectorHost } from '../connector-cloud/connector-host-install'
import type { Store } from '../persistence/loading-store/store'
import type { VshuRuntimeService } from '../runtime/vshu-runtime'
import type { BackendServiceCleanup } from '../backend/service-composition'

/** vshud's connector, as its own Vshu account and install id; installed before RPC admits a sign-in. */
export function installVshudConnector(
  runtime: VshuRuntimeService,
  store: Store,
  registerCleanup: (cleanup: BackendServiceCleanup) => void
): { connect: () => void } {
  let stopping = false
  const host = installConnectorHost({
    runtime,
    store,
    userDataPath: getAppEnvironment().getPath('userData'),
    kind: 'serve',
    isFenced: () => stopping
  })
  return {
    // vshud applies no persisted proxy, so it connects once its RPC is up. Call it after RPC and
    // automations register their cleanups: cleanups run newest first, so the fence comes before both.
    connect: () => {
      registerCleanup(async () => {
        stopping = true
        runtime.getConnectorCloud()?.fence()
        host.stop()
        // Records of which Slack drawing each bot shows get one bounded last try before exit.
        await runtime.bots.slackIcons.shownRecords.finalSave()
      })
      runtime.getConnectorCloud()?.connect()
    }
  }
}
