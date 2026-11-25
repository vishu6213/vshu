import { WslVshudBridgeActivity, wslHostBridgeEvents } from '../vshud/wsl-vshud-bridge-activity'
import { waitForIdleStoppedVshudExit } from './wsl-host-idle-stop'
import { listenWslVshudStdioBridge } from '../vshud/wsl-vshud-stdio-bridge'
import { createWslVshudPairingRecovery } from '../vshud/wsl-vshud-pairing-repair'
import {
  readSettledConfirmedRunningWslDistros,
  wasWslDistroLastSeenRunningSettled
} from '../discovery/wsl-background-distro-gate'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { verifyVshudPairingIdentity } from '../../managed-server/lifecycle/vshud-managed-tunnel-identity'
import { resolveEnvironmentPairingOffer } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findWslHostDeployment } from '../../../shared/remote-runtime/host-store/runtime-environment-wsl-host-store'
import { createWslDistroHolder } from '../discovery/wsl-distro-holder'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import { listWslHostDistros } from './wsl-host-distro-list'
import { resolveWslDistroName } from '../discovery/wsl-distro-registry-id'
import type { WslHostConnector, WslHostReachability } from './wsl-host-connector-contract'
import { readWslDistroVshudPublicKey } from './wsl-host-ssh-vshud-conflict'
import { WslVshudConnectionManager } from '../vshud/wsl-vshud-connection'
import type {
  WslVshudConnection,
  WslVshudConnectionDependencies
} from '../vshud/wsl-vshud-connection-types'
import { defaultWslVshudEnvironmentId, deployAndLaunchWslVshud } from '../vshud/wsl-vshud-deploy'
import { createWslVshudHostTransport } from '../vshud/wsl-vshud-host-transport'
import type { WslVshudHostTarget } from '../vshud/wsl-vshud-host-target'
import {
  decommissionWslHostVshud,
  stopWslHostServer,
  wslHostRuntimeStopSteps,
  type WslHostRuntimeAccess
} from './wsl-host-server-stop'
import { createWslVshudLivenessSupervisor } from '../vshud/wsl-vshud-liveness-wiring'
import type { WslVshudLivenessSupervisor } from '../vshud/wsl-vshud-liveness-supervisor'
import { confirmsRunning } from '../vshud/wsl-vshud-liveness-evidence'
import { requireConfirmedRunning } from '../vshud/wsl-vshud-connection-errors'
import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import { wslHostServerStopReason } from '../../../shared/remote-runtime/wsl-hosts/wsl-host-failure-copy'

function targetFor(distro: string): WslVshudHostTarget {
  return { kind: 'wsl', id: defaultWslVshudEnvironmentId(distro), distro, label: distro }
}

function transportFor(distro: string) {
  return createWslVshudHostTransport({ target: targetFor(distro) })
}

type Reachability = WslHostReachability

export function createWslHostConnector(options: {
  userDataPath: string
  onChange: NonNullable<WslVshudConnectionDependencies['onChange']>
  hasUserVisibleWork: (distro: string) => boolean | Promise<boolean>
  /** False once a distro's host is gone: nothing may be spawned for it again. */
  isKnownDistro: (distro: string) => boolean | Promise<boolean>
  runtime: WslHostRuntimeAccess
}): WslHostConnector {
  const refuseUnknown = (distro: string): Error =>
    new Error(`${distro} is no longer a WSL host; Vshu will not start anything for it.`)
  // Assigned below; a holder exit cannot arrive before the first ensure.
  let supervisor: WslVshudLivenessSupervisor | null = null
  const unguardedHolder = createWslDistroHolder({
    userDataPath: options.userDataPath,
    onHolderExit: (distro, exit) => supervisor?.noteHolderExit(distro, exit)
  })
  // Guard here because liveness recovery and deploy can bypass the service.
  const holder: WslDistroHolder = {
    ...unguardedHolder,
    ensureHeld: async (distro, ensureOptions) =>
      (await options.isKnownDistro(distro))
        ? unguardedHolder.ensureHeld(distro, ensureOptions)
        : Promise.reject(refuseUnknown(distro))
  }
  const pairingRecovery = createWslVshudPairingRecovery(options.userDataPath)
  // The desktop's own bridged sockets double as the liveness watch; no bridge is held for it.
  const bridgeActivity = new WslVshudBridgeActivity()
  const manager = new WslVshudConnectionManager({
    holder,
    listen: (transport, listenOptions) =>
      listenWslVshudStdioBridge(transport, {
        ...listenOptions,
        events: wslHostBridgeEvents(bridgeActivity, listenOptions)
      }),
    pairingRecovery,
    getPairingOffer: async (environmentId) =>
      (await findWslHostDeployment(options.userDataPath, environmentId))
        ? await resolveEnvironmentPairingOffer(options.userDataPath, environmentId)
        : null,
    recordedLocalPort: async (environmentId) =>
      (await findWslHostDeployment(options.userDataPath, environmentId))?.localPort ?? null,
    onChange: options.onChange,
    deployAndLaunch: async (distro, deployOptions) =>
      (await options.isKnownDistro(distro))
        ? deployAndLaunchWslVshud(distro, deployOptions)
        : Promise.reject(refuseUnknown(distro))
  })
  const liveness = createWslVshudLivenessSupervisor({
    manager,
    bridgeActivity,
    holder,
    hasUserVisibleWork: options.hasUserVisibleWork
  })
  supervisor = liveness
  // Liveness connects in flight, per distro; a plain connect meanwhile joins rather than re-arms.
  const livenessConnects = new Map<
    string,
    { promise: Promise<WslVshudConnection>; noBoot: boolean; intent: boolean }
  >()
  // Read right before a no-boot reconnect spawns anything in the distro (E9); settled, since a
  // list taken while the distro stops still names it.
  const requireRunning = async (distro: string): Promise<boolean> =>
    requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro)
  // A ready client can outlive its distro by a moment; only a settled running read lets it skip
  // the cold check, which never dials a stopped distro (E9). Reads the cache: no probe per call.
  const readyWhileRunning = async (distro: string, environmentId: string): Promise<boolean> =>
    Boolean(await options.runtime.isReady?.(environmentId)) &&
    wasWslDistroLastSeenRunningSettled(distro)
  const coldProbes = new Map<
    string,
    {
      connection: WslVshudConnection | null
      pairingOffer: string | undefined
      result: Promise<Reachability>
    }
  >()
  const probe = async (
    distro: string,
    environmentId: string,
    connection: WslVshudConnection | null
  ): Promise<Reachability> => {
    // Bridge dialing spawns wsl.exe; passive checks must first prove the distro runs.
    const running = await readSettledConfirmedRunningWslDistros(distro)
    if (running.status === 'unavailable') {
      return 'unavailable'
    }
    if (!confirmsRunning(running, wslDistroHolderKey(distro))) {
      return 'stopped'
    }
    if (!(await options.isKnownDistro(distro)) || manager.get(distro) !== connection) {
      return 'unreachable'
    }
    if ((await options.runtime.isReady?.(environmentId)) && manager.get(distro) === connection) {
      return 'available'
    }
    if (!connection) {
      return 'unreachable'
    }
    const offer = parsePairingCode(connection.pairingOffer)
    if (!offer) {
      return 'unreachable'
    }
    const identity = await verifyVshudPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
      runtimeId: null
    })
    return identity.verdict === 'verified' && manager.get(distro) === connection
      ? 'available'
      : 'unreachable'
  }
  const coldReachability = (distro: string, environmentId: string): Promise<Reachability> => {
    const key = `${wslDistroHolderKey(distro)}\0${environmentId}`
    const connection = manager.get(distro)
    const pairingOffer = connection?.pairingOffer
    const pending = coldProbes.get(key)
    if (pending && pending.connection === connection && pending.pairingOffer === pairingOffer) {
      return pending.result
    }
    const result = probe(distro, environmentId, connection).finally(() => {
      if (coldProbes.get(key)?.result === result) {
        coldProbes.delete(key)
      }
    })
    coldProbes.set(key, { connection, pairingOffer, result })
    return result
  }
  return {
    listDistros: () => listWslHostDistros(),
    readVshudPublicKey: (distro) => readWslDistroVshudPublicKey(transportFor(distro)),
    connect: (distro, { noBoot, ...connectOptions } = {}) => {
      const options = noBoot ? { ...connectOptions, requireRunning } : connectOptions
      const key = wslDistroHolderKey(distro)
      const pending = livenessConnects.get(key)
      // Why join: a second plain connect re-armed the liveness watch (an identity read and a watch
      // channel) and waited for it, which held a pane's first call about 1 s after ready. Never
      // join an Update/Force (its incumbent is on its way out) or, when booting, a no-boot one
      // (it may refuse, and nothing would arm).
      if (pending && !pending.intent && !options.intent && (noBoot || !pending.noBoot)) {
        // While the bridge connect runs, `get` names the server it replaces: wait for the new one.
        return manager.isConnecting(distro)
          ? manager.ensure(distro, options)
          : Promise.resolve(manager.get(distro) ?? manager.ensure(distro, options))
      }
      // Start, a due automation and a wake all wait out an idle-stopped vshud's exit (#46567).
      const connected = waitForIdleStoppedVshudExit(defaultWslVshudEnvironmentId(distro))
        .then(() => liveness.connect(distro, options))
        .finally(() => {
          if (livenessConnects.get(key)?.promise === connected) {
            livenessConnects.delete(key)
          }
        })
      livenessConnects.set(key, {
        promise: connected,
        noBoot: Boolean(noBoot),
        intent: Boolean(options.intent)
      })
      return connected
    },
    forgetPairingFailures: (environmentId) => pairingRecovery.repairs.forgetFailures(environmentId),
    get: (distro) => manager.get(distro),
    isReachable: async (distro, environmentId) =>
      (await readyWhileRunning(distro, environmentId)) ||
      (await coldReachability(distro, environmentId)) === 'available',
    isSettling: (distro) => liveness.isSettling(distro),
    reachability: async (distro, environmentId) =>
      (await readyWhileRunning(distro, environmentId))
        ? 'available'
        : coldReachability(distro, environmentId),
    disconnect: (distro) => liveness.stop(distro),
    stopServer: async (distro, environmentId) => {
      const reachability = await coldReachability(distro, environmentId)
      if (reachability === 'unavailable') {
        return {
          stopped: false,
          ...wslHostServerStopReason('serviceUnconfirmed'),
          verdict: 'unverifiable'
        }
      }
      if (reachability === 'stopped') {
        return { stopped: true }
      }
      if (reachability === 'unreachable') {
        await liveness.connect(distro)
      }
      const target = targetFor(distro)
      return stopWslHostServer({
        ...wslHostRuntimeStopSteps(options.runtime, environmentId),
        closeBridge: () => liveness.stop(distro),
        decommission: decommissionWslHostVshud(target, createWslVshudHostTransport({ target }))
      })
    },
    resolveDistroName: (distro, distroId) => resolveWslDistroName(distro, distroId),
    releaseHolder: async (distro) => {
      await holder.release(distro)
    },
    adoptHolders: async (isWanted) => {
      for (const { distro } of await holder.adoptHolders()) {
        if (!(await isWanted(distro))) {
          // Verified by pid, start time and command line; an unverifiable holder is kept.
          await holder.release(distro)
        }
      }
    },
    dispose: () => liveness.dispose()
  }
}
