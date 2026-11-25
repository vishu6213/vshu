import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { startVshudWithHost } from '../vshud/host-lifecycle/vshud-lifecycle'
import type { VshudHandle, VshudOptions } from '../vshud/serve-startup/vshud-start-contract'
import { activateBackendServices } from './service-composition'
import { BackendCoreProfileShutdown } from './core-profile-shutdown'

export type BackendCoreHost = {
  userDataPath: string
  supervised: boolean
  options: VshudOptions
  prepareCliLauncher(): Promise<void>
  prepareSecrets(userDataPath: string): Promise<void>
  runQuitHandlers(): void
}

export async function startBackendCore(host: BackendCoreHost): Promise<VshudHandle> {
  const { userDataPath } = host
  let closeObservability = (): Promise<void> => Promise.resolve()
  const profileShutdown = new BackendCoreProfileShutdown()
  const { readiness, instance, stop } = await startVshudWithHost(
    userDataPath,
    (registerCleanup) =>
      activateBackendServices({
        supervised: host.supervised,
        registerCleanup,
        activate: async (cleanup) => {
          const { activateBackendRuntime } = await import('./core-runtime-activation')
          return activateBackendRuntime(host, cleanup, profileShutdown, (close) => {
            closeObservability = close
          })
        }
      }),
    async () => {
      try {
        host.runQuitHandlers()
      } finally {
        // Close after quit handlers, including failed ones, so their spans reach disk.
        const closing = closeObservability()
        closeObservability = () => Promise.resolve()
        await closing
      }
    },
    profileShutdown.checkpoint
  )
  const version = getAppEnvironment().getVersion()
  return {
    readiness,
    managedStop: { version, runtimeId: readiness.runtimeId, instance },
    stop
  }
}
