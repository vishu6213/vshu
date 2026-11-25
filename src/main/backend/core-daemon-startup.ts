import type { BackendServiceCleanup } from './service-composition'
import type { createVshudStartupTiming } from '../vshud/diagnostics/vshud-startup-timing'

export async function prepareBackendDaemon(
  loginEnvironment: Promise<unknown>,
  timed: ReturnType<typeof createVshudStartupTiming>['time'],
  registerCleanup: (cleanup: BackendServiceCleanup) => void
) {
  const { startVshudDaemon, stopVshudDaemon } =
    await import('../vshud/daemon/vshud-daemon-supervision')
  // The daemon and its PTYs inherit the adopted login env and nothing later startup writes, so it
  // spawns as soon as that lands, alongside imports, stores and hooks. Rejects only when supervised.
  const daemonStartup = loginEnvironment.then(() => timed('daemon', () => startVshudDaemon()))
  // Observed now: an early abort may never reach the await below.
  void daemonStartup.catch(() => {})
  // Registered first, so it runs last (cleanups run in reverse) and covers an import that throws
  // mid-spawn. It disconnects without killing daemon PTYs that must survive restart, after an
  // in-flight spawn settles; a failed one leaves only the disconnect to do.
  registerCleanup(() => daemonStartup.catch(() => {}).then(() => stopVshudDaemon()))
  return { ready: daemonStartup }
}
