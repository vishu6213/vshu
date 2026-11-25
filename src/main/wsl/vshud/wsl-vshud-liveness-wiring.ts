/** C7 supplies visible demand; these production probes serve the WSL liveness supervisor. */
import {
  probeThenWatchWslVshudBridges,
  type WslVshudBridgeActivity
} from './wsl-vshud-bridge-activity'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import {
  type VshudTerminalCensus,
  UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import { requestVshudTerminalCensus } from '../../managed-server/lifecycle/vshud-terminal-census-client'
import { subscribeSystemPowerLifecycle } from '../../power/system-power-lifecycle'
import {
  deferUntilWslDistroRunning,
  readSettledConfirmedRunningWslDistros
} from '../discovery/wsl-background-distro-gate'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import { readWslGuestIdentity } from '../execution/wsl-guest-process-identity'
import type { WslVshudConnection } from './wsl-vshud-connection-types'
import type { WslVshudConnectionManager } from './wsl-vshud-connection'
import { defaultWslVshudEnvironmentId } from './wsl-vshud-deploy'
import { EXIT_SETTLE_MS } from './wsl-vshud-liveness-evidence'
import { requireConfirmedRunning } from './wsl-vshud-connection-errors'
import { WslVshudLivenessSupervisor } from './wsl-vshud-liveness-supervisor'
import { createWslVshudHostTransport } from './wsl-vshud-host-transport'
import { openWslVshudWatch } from './wsl-vshud-watch'
import { isWslHostIdleStopped } from '../host-lifecycle/wsl-host-idle-stop'

function transportFor(distro: string, environmentId = defaultWslVshudEnvironmentId(distro)) {
  return createWslVshudHostTransport({
    target: { kind: 'wsl', id: environmentId, distro, label: distro }
  })
}

/** Every session counts (activation time 0): liveness asks how many survived, not how new. */
function collectWslVshudCensus(connection: WslVshudConnection): Promise<VshudTerminalCensus> {
  const offer = parsePairingCode(connection.pairingOffer)
  return offer
    ? requestVshudTerminalCensus(pairedRuntimeConnectionFromOffer(offer), 0)
    : Promise.resolve(UNVERIFIABLE_VSHUD_TERMINAL_CENSUS)
}

export function createWslVshudLivenessSupervisor(options: {
  manager: WslVshudConnectionManager
  bridgeActivity: WslVshudBridgeActivity
  holder: WslDistroHolder
  hasUserVisibleWork: (distro: string) => boolean | Promise<boolean>
}): WslVshudLivenessSupervisor {
  return new WslVshudLivenessSupervisor({
    manager: options.manager,
    readRunning: ({ distro, exitedAt, probedAfter }) => {
      const settled =
        exitedAt === null || exitedAt === undefined ? undefined : exitedAt + EXIT_SETTLE_MS
      return readSettledConfirmedRunningWslDistros(
        distro,
        probedAfter === undefined ? settled : Math.max(settled ?? -Infinity, probedAfter)
      )
    },
    readIdentity: (distro, vshudPid) => readWslGuestIdentity(transportFor(distro), vshudPid),
    openWatch: (connection) =>
      probeThenWatchWslVshudBridges(
        () =>
          openWslVshudWatch(
            transportFor(connection.distro, connection.environmentId),
            connection.remotePort
          ),
        options.bridgeActivity,
        connection.environmentId
      ),
    collectCensus: collectWslVshudCensus,
    hasUserVisibleWork: options.hasUserVisibleWork,
    // Registered hosts use the default id; the idle-stop close lands before the exit's settle ends.
    wasIdleStopped: (distro) => isWslHostIdleStopped(defaultWslVshudEnvironmentId(distro)),
    deferUntilRunning: deferUntilWslDistroRunning,
    requireRunning: async (distro) =>
      requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro),
    // Liveness is background work: the holder may re-spawn only into a distro that runs (E9).
    ensureHolder: (distro) =>
      options.holder.ensureHeld(distro, {
        requireRunning: async () =>
          requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro)
      }),
    subscribePower: subscribeSystemPowerLifecycle
  })
}
