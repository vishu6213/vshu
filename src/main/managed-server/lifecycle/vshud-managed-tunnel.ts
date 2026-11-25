import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { probeManagedVshudTunnel } from './vshud-managed-tunnel-resume'
import {
  ensureManagedVshudServing,
  forgetManagedVshudServingVerdict
} from './vshud-managed-serving'
import { getManagedVshudCrashLoopBrake } from './vshud-managed-crash-loop'
import { VshudManagedTunnelManager } from './vshud-managed-tunnel-manager'
import { buildOnBindableLocalPort } from './vshud-managed-tunnel-local-port'
import { getRemoteRuntimeSharedControlAnsweredAt } from '../../ipc/runtime-environments/connections/runtime-environment-shared-control-answers'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'
import {
  MANAGED_VSHUD_TUNNEL_TARGETING,
  type VshudTunnelStartChecks
} from './vshud-managed-tunnel-target'
import {
  liveManagedVshudPairingRepairDeps,
  ManagedVshudPairingRepairs,
  pairingRevisionOf
} from './vshud-managed-pairing-repair'
import {
  buildWithPairingRepair,
  type ManagedVshudPairingRecovery
} from './vshud-managed-tunnel-pairing-recovery'

const managedTunnels = new VshudManagedTunnelManager({
  getConnectionManager: getSshConnectionManager,
  getTargetStore: getSshTargetRegistryStore,
  targeting: MANAGED_VSHUD_TUNNEL_TARGETING,
  ensureServing: (input) =>
    ensureManagedVshudServing({
      ...input,
      probe: probeManagedVshudTunnel,
      answeredAt: getRemoteRuntimeSharedControlAnsweredAt
    })
})

const pairingRepairs = new Map<string, ManagedVshudPairingRepairs>()

function pairingRecovery(userDataPath: string): ManagedVshudPairingRecovery {
  let repairs = pairingRepairs.get(userDataPath)
  if (!repairs) {
    repairs = new ManagedVshudPairingRepairs(liveManagedVshudPairingRepairDeps(userDataPath))
    pairingRepairs.set(userDataPath, repairs)
  }
  return {
    resolve: async (environmentId) => await resolveEnvironment(userDataPath, environmentId),
    repairs,
    ensure: (environment) =>
      managedTunnels.ensure(
        environment,
        async () => await resolveEnvironmentOrNull(userDataPath, environment.id)
      )
  }
}

/** Return stored credentials: tunnel repair may have replaced the pairing. */
export async function ensureVshudManagedTunnel(
  userDataPath: string,
  selector: string
): Promise<KnownRuntimeEnvironment> {
  const { id } = await resolveEnvironment(userDataPath, selector)
  await buildOnBindableLocalPort(userDataPath, id, () =>
    buildWithPairingRepair(pairingRecovery(userDataPath), id, (environment) =>
      managedTunnels.ensure(
        environment,
        async () => await resolveEnvironmentOrNull(userDataPath, id)
      )
    )
  )
  return await resolveEnvironment(userDataPath, id)
}

export async function rebuildVshudManagedTunnel(
  userDataPath: string,
  selector: string
): Promise<'built' | 'repaired'> {
  const { id } = await resolveEnvironment(userDataPath, selector)
  return buildOnBindableLocalPort(userDataPath, id, () =>
    buildWithPairingRepair(pairingRecovery(userDataPath), id, (environment) =>
      managedTunnels.rebuild(
        environment,
        async () => await resolveEnvironmentOrNull(userDataPath, id)
      )
    )
  )
}

/** Reprove pinned-server refusal before repair; foreign servers must fail identity validation. */
export function recoverRefusedManagedVshudPairing(
  userDataPath: string,
  environmentId: string
): Promise<'built' | 'repaired'> {
  return rebuildVshudManagedTunnel(userDataPath, environmentId)
}

/** Ignore failures belonging to older pairing revisions. */
export async function managedVshudPairingFailureStands(
  userDataPath: string,
  environmentId: string
): Promise<boolean> {
  const environment = await resolveEnvironmentOrNull(userDataPath, environmentId)
  return (
    environment !== null &&
    (pairingRepairs
      .get(userDataPath)
      ?.standingFailure(environmentId, pairingRevisionOf(environment)) ?? null) !== null
  )
}

/** Explicit connect clears recent repair failures and re-arms automatic starts. */
export function forgetManagedVshudAutomaticFailures(
  userDataPath: string,
  environmentId: string
): void {
  pairingRepairs.get(userDataPath)?.forgetFailures(environmentId)
  getManagedVshudCrashLoopBrake().forget(environmentId)
  forgetManagedVshudServingVerdict(environmentId)
}

async function resolveEnvironmentOrNull(userDataPath: string, id: string) {
  try {
    return await resolveEnvironment(userDataPath, id)
  } catch {
    return null
  }
}

export function verifyManagedTunnelServing(environment: KnownRuntimeEnvironment) {
  return managedTunnels.verifyServing(environment)
}

export function disposeVshudManagedTunnels(): void {
  managedTunnels.dispose()
}

// System SSH forwards have independent processes and can outlive Vshu.
export function shutdownVshudManagedTunnels(): Promise<void> {
  return managedTunnels.shutdown()
}

export function recoverVshudManagedTunnelsAfterHostResume(
  userDataPath: string,
  options: { attempts: number; timeoutMs: number }
): Promise<void> {
  return managedTunnels.recoverAfterHostResume({
    ...options,
    resolveEnvironment: async (environmentId) =>
      await resolveEnvironmentOrNull(userDataPath, environmentId)
  })
}

export function startVshudManagedTunnel(
  environmentId: string,
  target: SshTarget,
  connection: SshConnection,
  remotePort: number,
  checks?: VshudTunnelStartChecks
): Promise<number> {
  return managedTunnels.start(environmentId, target, connection, remotePort, checks)
}

export function closeVshudManagedTunnel(environmentId: string): Promise<void> {
  return managedTunnels.close(environmentId)
}

export function closeVshudManagedTunnelsForTarget(targetId: string): Promise<void> {
  return managedTunnels.closeTarget(targetId)
}
