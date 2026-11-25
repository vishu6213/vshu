import type { Store } from '../../persistence/loading-store/store'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import { SshConnectionStore } from '../targets/ssh-connection-store'
import { SshConnectionManager } from '../connection/ssh-connection-manager'
import { SshPortForwardManager } from '../port-forwarding/ssh-port-forward'
import { Ssh2PortForwardProvider } from '../port-forwarding/ssh2-port-forward-provider'
import { SystemSshPortForwardProvider } from '../port-forwarding/system-ssh-port-forward-provider'
import {
  getSshTargetRegistryStore,
  setSshConnectionManagerResolver,
  setSshTargetRegistryStore
} from '../targets/ssh-target-registry'
import { initializeSshConnectionGenerationSession } from '../connection/authority/ssh-connection-generation'
import { setSshHostServedListener } from '../host-server/ssh-host-server-status'
import { setSshStartupReady } from '../../ipc/ssh/ssh-startup-ready'
import { awaitSignInForCredentialHosts } from '../../ipc/ssh/ssh-sign-in-requirement'
import { holdLaunchReconnectOptOuts } from '../../ipc/ssh/ssh-host-user-disconnect'
import { createSshConnectionCallbacks } from '../../ipc/ssh/ssh-connection-state-callbacks'
import { registerPowerMonitorReconnect } from '../../ipc/ssh/ssh-host-sleep-reconnect'
import {
  connectionManager,
  portForwardManager,
  setConnectionManager,
  setCurrentRuntime,
  setPersistedStore,
  setPortForwardManager
} from '../../ipc/ssh/ssh-ipc-context'
import { persistPortForwards } from '../../ipc/ssh/ssh-port-forward-persistence'
import { recordForwardFailure } from '../../ipc/ssh/ssh-port-forward-unrestored'
import { restoreManagedHostPortForwards } from '../../ipc/ssh/ssh-managed-port-forward-restore'
import { broadcastPortForwards } from '../../ipc/ssh/ssh-renderer-broadcast'
import { registerSshTargetCrudHandlers } from '../../ipc/ssh/ssh-target-crud-handlers'
import { registerSshConnectionHandlers } from '../../ipc/ssh/ssh-connection-handlers'
import { registerSshPortForwardHandlers } from '../../ipc/ssh/ssh-port-forward-handlers'
import { installManagedVshudStartStatus } from '../../ipc/runtime-environments/managed-vshud/runtime-environment-managed-tunnel'
import { retainUnretainedVshudMigrationSources } from '../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-source-retention'
import { reconcileManagedVshudSshTargets } from '../../persistence/migrating-vshud-catalog/retained-source/vshud-retained-source'
import { installVshudMigrationScrollbackRetention } from '../../persistence/migrating-vshud-catalog/terminal-history/vshud-migration-scrollback-retention-wiring'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import type { RegisterSshRequest } from './ssh-application-requests'

/**
 * The single SSH target/connection/forward/relay owner. Native effects come from the installed
 * SshDesktopHost; renderer requests reach it through `register`, gated on startup reconciliation.
 * Re-running it (macOS window recreation) rebinds the same managers rather than replacing them.
 */
export async function startSshApplication({
  store,
  runtime,
  hostInitialization,
  register,
  beforeReady
}: {
  store: Store
  runtime?: VshuRuntimeService
  hostInitialization?: Promise<void>
  register: RegisterSshRequest
  /** Synchronous wiring that must exist before startup reconciliation settles. */
  beforeReady?: () => void
}): Promise<{ connectionManager: SshConnectionManager; sshStore: SshConnectionStore }> {
  initializeSshConnectionGenerationSession()
  setCurrentRuntime(runtime)
  setSshTargetRegistryStore(new SshConnectionStore(store))
  setPersistedStore(store)
  const ready = (async () => {
    await hostInitialization
    await holdLaunchReconnectOptOuts(getSshTargetRegistryStore()!.listTargets())
    await reconcileManagedVshudSshTargets(getAppEnvironment().getPath('userData'), store)
  })()
  setSshStartupReady(ready)
  const handle: RegisterSshRequest = (channel, operation) =>
    register(channel, async (args) => {
      await ready
      return operation(args)
    })

  const callbacks = createSshConnectionCallbacks()
  if (connectionManager) {
    connectionManager.setCallbacks(callbacks)
  } else {
    setConnectionManager(new SshConnectionManager(callbacks))
    // Window re-registration must not re-gate hosts already signed in during this process.
    awaitSignInForCredentialHosts(getSshTargetRegistryStore()!)
  }
  setPortForwardManager(
    portForwardManager ??
      new SshPortForwardManager({}, [
        new Ssh2PortForwardProvider(),
        new SystemSshPortForwardProvider()
      ])
  )
  portForwardManager!.setCallbacks({
    onForwardClosed: (entry, reason) => {
      if (reason.kind === 'unexpected-exit') {
        console.warn(
          `[ssh] Port forward ${entry.localPort} → ${entry.remoteHost}:${entry.remotePort} closed unexpectedly${
            reason.detail ? `: ${reason.detail}` : ''
          }`
        )
        // An ssh that starts and later dies backs off like one that never started.
        recordForwardFailure(
          entry.connectionId,
          entry,
          reason.detail ?? 'exited unexpectedly',
          'exit'
        )
      }
      persistPortForwards(entry.connectionId)
      broadcastPortForwards(entry.connectionId)
    }
  })
  // Every served status restores saved forwards, whichever path brought the host up.
  setSshHostServedListener((targetId) => void restoreManagedHostPortForwards(targetId))
  registerPowerMonitorReconnect(() => getAppEnvironment().getPath('userData'))
  setSshConnectionManagerResolver(() => connectionManager)

  registerSshTargetCrudHandlers(handle)
  registerSshConnectionHandlers(handle)
  registerSshPortForwardHandlers(handle)
  beforeReady?.()

  await ready
  void retainUnretainedVshudMigrationSources(getAppEnvironment().getPath('userData'), store)
  installVshudMigrationScrollbackRetention(getAppEnvironment().getPath('userData'), store)
  installManagedVshudStartStatus()
  return {
    connectionManager: connectionManager!,
    sshStore: getSshTargetRegistryStore() as SshConnectionStore
  }
}
