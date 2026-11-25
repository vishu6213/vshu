import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { isAuthError } from '../../ssh/connection/reconnect/ssh-reconnect-error-classification'
import type { SshConnectionManager } from '../../ssh/connection/ssh-connection-manager'
import { SshPortForwardManager } from '../../ssh/port-forwarding/ssh-port-forward'
import { VshudManagedTunnelTransportProvider } from './vshud-managed-tunnel-transport'
import {
  VshudManagedTunnelResumeRecovery,
  type VshudManagedServingCheck,
  type VshudManagedTunnelProbe,
  type VshudManagedTunnelResumeOptions
} from './vshud-managed-tunnel-resume'
import type { VshudManagedServing } from './vshud-managed-serving'
import {
  activeTunnelMatches,
  dropActiveVshudTunnel,
  managedTunnelStillPaired,
  recordActiveVshudTunnel,
  resolveManagedTunnelBinding,
  supersededTunnelError,
  type ActiveVshudTunnel
} from './vshud-managed-tunnel-active'
import { checkManagedTunnelServing, type VshudTunnelServing } from './vshud-managed-tunnel-serving'
import type { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import {
  environmentForwardChecks,
  forwardToVerifiedVshud,
  PERSISTED_PORT_TARGETING,
  type VshudManagedTunnelTargeting,
  type VshudTunnelStartChecks
} from './vshud-managed-tunnel-target'

type VshudManagedTunnelDependencies = {
  getConnectionManager: () => SshConnectionManager | null
  getTargetStore: () => ReturnType<typeof getSshTargetRegistryStore>
  forwardManager?: SshPortForwardManager
  probeTunnel?: VshudManagedTunnelProbe
  targeting?: VshudManagedTunnelTargeting
  /** Start proven-stopped servers after a fresh forward opens. */
  ensureServing?: VshudManagedServingCheck
}

export class VshudManagedTunnelManager {
  private readonly active = new Map<string, ActiveVshudTunnel>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly ownershipGenerations = new Map<string, number>()
  // Track in-flight build targets so Disconnect can supersede unrecorded forwards.
  private readonly buildTargets = new Map<string, string>()
  private readonly forwards: SshPortForwardManager
  private readonly resumeRecovery: VshudManagedTunnelResumeRecovery
  private readonly targeting: VshudManagedTunnelTargeting
  private managerGeneration = 0

  constructor(private readonly dependencies: VshudManagedTunnelDependencies) {
    this.forwards =
      dependencies.forwardManager ??
      new SshPortForwardManager({}, [new VshudManagedTunnelTransportProvider()])
    this.targeting = dependencies.targeting ?? PERSISTED_PORT_TARGETING
    this.resumeRecovery = new VshudManagedTunnelResumeRecovery({
      active: this.active,
      forwards: this.forwards,
      getConnectionManager: dependencies.getConnectionManager,
      getManagerGeneration: () => this.managerGeneration,
      getTargetStore: dependencies.getTargetStore,
      inFlight: this.inFlight,
      ownershipGenerations: this.ownershipGenerations,
      probeTunnel: dependencies.probeTunnel,
      targeting: this.targeting,
      checkServing: (environment) => this.checkServing(environment)
    })
    this.forwards.setCallbacks({
      onForwardClosed: (entry) => {
        for (const [environmentId, active] of this.active) {
          if (active.forwardId === entry.id) {
            this.active.delete(environmentId)
          }
        }
      }
    })
  }

  ensure(
    environment: KnownRuntimeEnvironment,
    resolveCurrent: () =>
      | KnownRuntimeEnvironment
      | null
      | Promise<KnownRuntimeEnvironment | null> = () => environment,
    retryJoined = true
  ): Promise<void> {
    if (!getRuntimeSshAccess(environment)) {
      return Promise.resolve()
    }
    const pending = this.inFlight.get(environment.id)
    if (pending) {
      // Retry joined runs cancelled by another caller; authentication failures remain authoritative.
      return pending.catch((error: unknown) =>
        retryJoined && !(error instanceof Error && isAuthError(error))
          ? this.ensure(environment, resolveCurrent, false)
          : Promise.reject(error)
      )
    }
    const operation = this.ensureManagedTunnel(environment, resolveCurrent).finally(() => {
      if (this.inFlight.get(environment.id) === operation) {
        this.inFlight.delete(environment.id)
      }
    })
    this.inFlight.set(environment.id, operation)
    return operation
  }

  async rebuild(
    environment: KnownRuntimeEnvironment,
    resolveCurrent: () =>
      | KnownRuntimeEnvironment
      | null
      | Promise<KnownRuntimeEnvironment | null> = () => environment
  ): Promise<void> {
    await this.inFlight.get(environment.id)?.catch(() => undefined)
    const active = this.active.get(environment.id)
    if (active) {
      await dropActiveVshudTunnel(this.active, this.forwards, environment.id, active)
    }
    await this.ensure(environment, resolveCurrent)
  }

  async start(
    environmentId: string,
    target: SshTarget,
    connection: SshConnection,
    remotePort: number,
    checks: VshudTunnelStartChecks = {}
  ): Promise<number> {
    if (!target.generation) {
      throw new Error('Managed Vshu SSH target has no registration generation.')
    }
    this.buildTargets.set(environmentId, target.id)
    const managerGeneration = this.managerGeneration
    const ownershipGeneration = (this.ownershipGenerations.get(environmentId) ?? 0) + 1
    const transportGeneration = connection.getConnectGeneration()
    const stillCurrent = (): boolean =>
      this.managerGeneration === managerGeneration &&
      this.ownershipGenerations.get(environmentId) === ownershipGeneration &&
      connection.getConnectGeneration() === transportGeneration
    await this.close(environmentId)
    if (!stillCurrent()) {
      throw supersededTunnelError()
    }
    const forward = await forwardToVerifiedVshud({
      targetId: target.id,
      connection,
      forwards: this.forwards,
      localPort: 0,
      label: 'Vshu on this host',
      remotePort,
      rereadRemotePort: checks.rereadRemotePort,
      verify: checks.verify,
      stillCurrent
    })
    // Teardown may occur between the build's last check and recording its forward.
    if (!forward || !stillCurrent()) {
      await (forward && this.forwards.removeForwardAndWait(forward.id))
      throw supersededTunnelError()
    }
    recordActiveVshudTunnel(this.active, environmentId, forward, {
      connection,
      preferredPort: checks.preferredPort ?? remotePort,
      sshTargetGeneration: target.generation,
      targetId: target.id,
      transportGeneration
    })
    return forward.localPort
  }

  async close(environmentId: string): Promise<void> {
    this.ownershipGenerations.set(
      environmentId,
      (this.ownershipGenerations.get(environmentId) ?? 0) + 1
    )
    const active = this.active.get(environmentId)
    if (!active) {
      return
    }
    this.active.delete(environmentId)
    await this.forwards.removeForwardAndWait(active.forwardId)
  }

  async closeTarget(targetId: string): Promise<void> {
    const environmentIds = new Set([...this.buildTargets.keys(), ...this.active.keys()])
    const carried = [...environmentIds].filter(
      (id) => this.buildTargets.get(id) === targetId || this.active.get(id)?.targetId === targetId
    )
    // Include unrecorded forwards still starting or checking identity.
    await Promise.all([
      ...carried.map((environmentId) => this.close(environmentId)),
      this.forwards.removeAllForwards(targetId)
    ])
  }

  async shutdown(): Promise<void> {
    this.managerGeneration += 1
    this.active.clear()
    await this.forwards.closeAll()
  }

  dispose(): void {
    this.managerGeneration += 1
    this.active.clear()
    this.inFlight.clear()
    this.ownershipGenerations.clear()
    this.buildTargets.clear()
    this.resumeRecovery.dispose()
    this.forwards.dispose()
  }

  async verifyServing(environment: KnownRuntimeEnvironment): Promise<VshudManagedServing> {
    if (!this.active.has(environment.id)) {
      await this.ensure(environment)
    }
    const serving = await this.checkServing(environment)
    if (serving.rebind) {
      await this.ensure(environment)
    }
    // The new tunnel may reach a different port; its server needs a fresh serving check.
    return serving.rebind && serving.state !== 'started' ? this.checkServing(environment) : serving
  }

  /** Safe during builds: drop moved-port forwards without recursively rebuilding. */
  checkServing(environment: KnownRuntimeEnvironment): Promise<VshudTunnelServing> {
    return checkManagedTunnelServing({
      environment,
      active: this.active,
      getTarget: (id) => this.dependencies.getTargetStore()?.getTarget(id),
      forwards: this.forwards,
      ensureServing: this.dependencies.ensureServing,
      readPublishedPort: this.targeting.readPublishedPort
    })
  }

  recoverAfterHostResume(options: VshudManagedTunnelResumeOptions): Promise<void> {
    return this.resumeRecovery.recover(options)
  }

  private async ensureManagedTunnel(
    environment: KnownRuntimeEnvironment,
    resolveCurrent: () => KnownRuntimeEnvironment | null | Promise<KnownRuntimeEnvironment | null>,
    rebound = false
  ): Promise<void> {
    const { deployment, targetStore, connectionManager, target } = resolveManagedTunnelBinding(
      environment,
      this.dependencies
    )
    this.buildTargets.set(environment.id, target.id)
    const managerGeneration = this.managerGeneration
    const ownershipGeneration = this.ownershipGenerations.get(environment.id) ?? 0
    const expected = { environmentId: environment.id, ...deployment }
    const stillOwned = async (): Promise<() => boolean> => {
      const current = await resolveCurrent()
      return () =>
        this.managerGeneration === managerGeneration &&
        (this.ownershipGenerations.get(environment.id) ?? 0) === ownershipGeneration &&
        managedTunnelStillPaired(environment, current, targetStore.getTarget(target.id), expected)
    }
    const connection = await connectionManager.connect(target)
    if (!(await stillOwned())()) {
      throw supersededTunnelError()
    }
    const transportGeneration = connection.getConnectGeneration()
    const active = this.active.get(environment.id)
    if (activeTunnelMatches(active, { connection, transportGeneration, target, deployment })) {
      return
    }
    const checks = await environmentForwardChecks(this.targeting, {
      environment,
      target,
      connection
    })
    if (active && (await stillOwned())()) {
      await dropActiveVshudTunnel(this.active, this.forwards, environment.id, active)
    }
    if (!(await stillOwned())()) {
      throw supersededTunnelError()
    }
    const forward = await forwardToVerifiedVshud({
      targetId: target.id,
      connection,
      forwards: this.forwards,
      localPort: deployment.localPort,
      label: `Vshu on ${environment.name}`,
      ...checks,
      stillCurrent: async () => {
        const owned = await stillOwned()
        return () => owned() && connection.getConnectGeneration() === transportGeneration
      }
    })
    if (!forward) {
      throw supersededTunnelError()
    }
    recordActiveVshudTunnel(this.active, environment.id, forward, {
      connection,
      preferredPort: deployment.remotePort,
      sshTargetGeneration: deployment.sshTargetGeneration,
      targetId: target.id,
      transportGeneration
    })
    const recorded = this.active.get(environment.id)
    const serving = await this.checkServing(environment)
    if (!(await stillOwned())() || connection.getConnectGeneration() !== transportGeneration) {
      if (recorded) {
        await dropActiveVshudTunnel(this.active, this.forwards, environment.id, recorded)
      }
      throw supersededTunnelError()
    }
    if (serving.rebind && !rebound) {
      await this.ensureManagedTunnel(environment, resolveCurrent, true)
    }
  }
}
