/** One in-memory connection per distro: C4 launch, C5 stdio bridge and loopback-rewritten pairing. Rebind when vshud moves ports; C7 persists onChange results. */
import type {
  WslVshudConnection,
  WslVshudConnectionDependencies
} from './wsl-vshud-connection-types'
import {
  assertWslDistroMayStart,
  isQuietConnectFailure,
  WslVshudConnectionSupersededError,
  WslVshudLaunchDeferredError
} from './wsl-vshud-connection-errors'
import type { WslHostConnectIntent } from '../../../shared/remote-runtime/wsl-hosts/wsl-host-types'
import { errorMessage } from '../../../shared/errors/error-message'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import {
  wslConnectFailedStatus,
  wslConnectingStatus,
  type WslVshudConnectionStatus
} from './wsl-vshud-connection-status'
import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import { defaultWslVshudEnvironmentId, deployAndLaunchWslVshud } from './wsl-vshud-deploy'
import type { WslVshudLaunch } from './wsl-vshud-launch-contract'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'
import { createWslVshudHostTransport } from './wsl-vshud-host-transport'
import { resolveWslVshudPairing } from './wsl-vshud-pairing-identity'
import { trackWslVshudHostEnvironment } from './wsl-vshud-host-environments'
import { listenWslVshudStdioBridgeOnPreferredPort } from './wsl-vshud-stdio-bridge'
import { wslConnectDeploySpawns } from './wsl-vshud-connect-stop-fence'

export type WslVshudConnectOptions = {
  environmentId?: string
  label?: string
  /** Rebinds a port a persisted pairing offer already names; 0 or absent picks a free one. */
  localPort?: number
  intent?: WslHostConnectIntent
  signal?: AbortSignal
  /** What `onChange` reports while this connect runs and once it is ready (liveness recovery). */
  status?: WslVshudConnectStatus
  /** E9 no-boot reconnect: refuse unless this confirms the distro runs, right before any spawn. */
  requireRunning?: (distro: string) => Promise<boolean>
}

type WslVshudConnectStatus = { pending: WslVshudConnectionStatus; ready: WslVshudConnectionStatus }

const CONNECTING: WslVshudConnectionStatus = { state: 'connecting' }
const READY: WslVshudConnectionStatus = { state: 'ready', census: null }

type ActiveWslVshudConnection = {
  connection: WslVshudConnection
  forward: StartedPortForward
}

type InFlightWslVshudConnect = { promise: Promise<WslVshudConnection>; noBoot: boolean }

export class WslVshudConnectionManager {
  private readonly active = new Map<string, ActiveWslVshudConnection>()
  private readonly inFlight = new Map<string, InFlightWslVshudConnect>()
  private readonly generations = new Map<string, number>()

  constructor(private readonly dependencies: WslVshudConnectionDependencies = {}) {}

  /** Joins a connect already running for this distro rather than racing a second bridge. */
  ensure(distro: string, options: WslVshudConnectOptions = {}): Promise<WslVshudConnection> {
    const name = distro.trim()
    if (!name) {
      return Promise.reject(new Error('A WSL distro name is required'))
    }
    const key = wslDistroHolderKey(name)
    const pending = this.inFlight.get(key)
    if (pending) {
      if (!options.intent && (!pending.noBoot || options.requireRunning)) {
        return pending.promise
      }
      // Update/Force needs its own deploy, and a connect that may boot can't ride on one that may
      // not (it would refuse a stopped distro the user asked for); run after it instead.
      const generation = this.generation(key)
      return pending.promise
        .catch(() => {})
        .then(() => {
          if (this.generation(key) !== generation) {
            throw new WslVshudConnectionSupersededError(name)
          }
          return this.ensure(distro, options)
        })
    }
    const status = options.status ?? { pending: CONNECTING, ready: READY }
    // Unchanged live refresh stays quiet; liveness recovery must publish.
    // A no-boot connect may be refused quietly, so it must not leave the row on "Connecting";
    // an explicit status (liveness recovery) is still published.
    if (options.status || (!this.active.has(key) && !options.requireRunning)) {
      this.dependencies.onChange?.(name, this.get(name), status.pending)
    }
    const operation = this.connect(name, key, options, status).catch((error: unknown) => {
      // Liveness owns reconnect status; superseded and no-boot-refused connects publish nothing.
      if (!options.status && !isQuietConnectFailure(error)) {
        const deferral = error instanceof WslVshudLaunchDeferredError ? error.launch : null
        const failed = wslConnectFailedStatus(errorMessage(error), deferral)
        this.dependencies.onChange?.(name, this.get(name), failed)
      }
      throw error
    })
    const tracked: Promise<WslVshudConnection> = operation.finally(() => {
      if (this.inFlight.get(key)?.promise === tracked) {
        this.inFlight.delete(key)
      }
    })
    this.inFlight.set(key, { promise: tracked, noBoot: Boolean(options.requireRunning) })
    return tracked
  }

  /** Prefer persisted enrollment; only unrecorded hosts fall back to their live connection offer. */
  private async enrolledOffer(key: string, environmentId: string): Promise<PairingOffer | null> {
    const current = this.active.get(key)?.connection
    return (
      (await this.dependencies.getPairingOffer?.(environmentId)) ??
      (current?.environmentId === environmentId ? parsePairingCode(current.pairingOffer) : null)
    )
  }

  get(distro: string): WslVshudConnection | null {
    return this.active.get(wslDistroHolderKey(distro))?.connection ?? null
  }

  /** A connect is running for this distro, so `get` may still name the server it replaces. */
  isConnecting(distro: string): boolean {
    return this.inFlight.has(wslDistroHolderKey(distro))
  }

  /** Liveness reports a status change for a distro, with whatever connection it has now. */
  publish(distro: string, status: WslVshudConnectionStatus): void {
    this.dependencies.onChange?.(distro, this.get(distro), status)
  }

  list(): WslVshudConnection[] {
    return [...this.active.values()].map((entry) => entry.connection)
  }

  async close(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    this.generations.set(key, this.generation(key) + 1)
    const entry = this.active.get(key)
    if (!entry) {
      return
    }
    await this.drop(key, entry)
    this.dependencies.onChange?.(entry.connection.distro, null, { state: 'closed' })
  }

  /**
   * Ends the loopback listener but keeps the published status: once vshud idled out or the distro
   * stopped, any dial to it would spawn wsl.exe and boot the distro again.
   */
  async retireListener(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    const entry = this.active.get(key)
    // A user connect in flight owns the next entry; retiring it would undo that connect.
    if (entry && !this.inFlight.has(key)) {
      await this.drop(key, entry)
    }
  }

  /** Retires one bridge; unlike close, a connect queued behind it still runs. */
  private async drop(key: string, entry: ActiveWslVshudConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      this.active.delete(key)
    }
    await entry.forward.close()
    trackWslVshudHostEnvironment(entry.connection, null)
  }

  async dispose(): Promise<void> {
    const keys = new Set([...this.active.keys(), ...this.inFlight.keys()])
    await Promise.all([...keys].map((key) => this.close(key)))
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0
  }

  private async connect(
    distro: string,
    key: string,
    options: WslVshudConnectOptions,
    status: WslVshudConnectStatus
  ): Promise<WslVshudConnection> {
    // Taken before any await, so a close during the running-list read still supersedes this.
    const generation = this.generation(key)
    const stillCurrent = (): boolean => this.generation(key) === generation
    await assertWslDistroMayStart(distro, options.requireRunning, stillCurrent)
    const environmentId = options.environmentId ?? defaultWslVshudEnvironmentId(distro)
    const label = options.label ?? distro
    const target = { kind: 'wsl', id: environmentId, distro, label } as const
    const transport = (this.dependencies.createTransport ?? defaultTransport)(target)
    const spawns = wslConnectDeploySpawns(distro, transport, this.dependencies, options)
    // Relaunch stopped vshud on each connect so distro restarts recover.
    const launch = await (this.dependencies.deployAndLaunch ?? deployAndLaunchWslVshud)(distro, {
      environmentId,
      label,
      intent: options.intent,
      pairedOffer: await this.enrolledOffer(key, environmentId),
      signal: options.signal,
      // Only a connect that showed "Connecting" says what it waits for; null (lock taken) clears it.
      onInstallLockWait: (wait) => {
        if (!options.status && !options.requireRunning && !this.active.has(key) && stillCurrent()) {
          this.dependencies.onChange?.(distro, null, wslConnectingStatus(wait))
        }
      },
      ...spawns.options
    }).finally(spawns.dispose)
    if (launch.outcome === 'deferred') {
      throw new WslVshudLaunchDeferredError(launch)
    }
    if (this.generation(key) !== generation) {
      throw new WslVshudConnectionSupersededError(distro)
    }
    const current = this.active.get(key)
    const persisted = (await this.dependencies.getPairingOffer?.(environmentId)) ?? null
    const paired = persisted ?? (await this.enrolledOffer(key, environmentId))
    // Repair only persisted enrollment; an in-progress Add has no stored record to repair.
    const recovery =
      persisted && this.dependencies.pairingRecovery
        ? { ...this.dependencies.pairingRecovery, environmentId }
        : undefined
    if (
      current &&
      current.connection.remotePort === launch.port &&
      current.connection.environmentId === environmentId
    ) {
      const pairingOffer = await resolveWslVshudPairing(
        launch,
        current.connection.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      ).catch(async (error: unknown) => {
        // Retire the rejected bridge or publishing its stale token would overwrite pairing repaired by the gate.
        await this.drop(key, current)
        throw error
      })
      if (this.generation(key) !== generation) {
        throw new WslVshudConnectionSupersededError(distro)
      }
      return this.refreshOffer(
        key,
        current,
        launch,
        pairingOffer,
        options.status ? status.ready : null
      )
    }
    // Port changes invalidate the old bridge; reuse its local port, else the recorded one, when possible.
    const preferredLocalPort =
      current?.connection.localPort ??
      options.localPort ??
      (await this.dependencies.recordedLocalPort?.(environmentId)) ??
      0
    if (current) {
      await this.drop(key, current)
      this.dependencies.onChange?.(distro, null, status.pending)
    }
    const forward = await listenWslVshudStdioBridgeOnPreferredPort(
      transport,
      {
        environmentId,
        distro,
        remotePort: launch.port,
        localPort: preferredLocalPort,
        label: `Vshu server in WSL: ${label}`
      },
      this.dependencies.listen
    )
    try {
      if (this.generation(key) !== generation) {
        throw new WslVshudConnectionSupersededError(distro)
      }
      const pairingOffer = await resolveWslVshudPairing(
        launch,
        forward.entry.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      )
      if (this.generation(key) !== generation) {
        throw new WslVshudConnectionSupersededError(distro)
      }
      const entry: ActiveWslVshudConnection = {
        forward,
        connection: {
          distro,
          environmentId,
          localPort: forward.entry.localPort,
          remotePort: launch.port,
          fullVersion: launch.fullVersion,
          pid: launch.pid,
          pairingOffer,
          deferredUpdate: launch.deferredUpdate ?? null,
          close: () => this.closeEntry(key, entry)
        }
      }
      this.active.set(key, entry)
      trackWslVshudHostEnvironment(entry.connection, entry.connection)
      this.dependencies.onChange?.(distro, entry.connection, status.ready)
      return entry.connection
    } catch (error) {
      await forward.close()
      throw error
    }
  }

  private refreshOffer(
    key: string,
    entry: ActiveWslVshudConnection,
    launch: Extract<WslVshudLaunch, { outcome: 'ready' }>,
    pairingOffer: string,
    /** Reported even when nothing changed; null stays quiet then. */
    announce: WslVshudConnectionStatus | null
  ): WslVshudConnection {
    const deferredUpdate = launch.deferredUpdate ?? null
    const changed =
      pairingOffer !== entry.connection.pairingOffer ||
      launch.fullVersion !== entry.connection.fullVersion ||
      launch.pid !== entry.connection.pid ||
      JSON.stringify(deferredUpdate) !== JSON.stringify(entry.connection.deferredUpdate)
    if (changed) {
      const { fullVersion, pid } = launch
      entry.connection = { ...entry.connection, pairingOffer, fullVersion, pid, deferredUpdate }
      this.active.set(key, entry)
    }
    trackWslVshudHostEnvironment(entry.connection, entry.connection)
    if (changed || announce) {
      this.dependencies.onChange?.(entry.connection.distro, entry.connection, announce ?? READY)
    }
    return entry.connection
  }

  private async closeEntry(key: string, entry: ActiveWslVshudConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      await this.close(key)
    }
  }
}

function defaultTransport(target: WslVshudHostTarget): VshudHostTransport {
  return createWslVshudHostTransport({ target })
}
