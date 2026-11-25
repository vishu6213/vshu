// Target claims preserve environment identity so interrupted deploys resume the same registration.
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/remote-runtime/host-catalog/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { addManagedVshudEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import {
  getVshudSshDeployment,
  redactRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  VSHUD_MANAGED_REMOTE_PORT,
  type VshudManagedDeferral,
  type VshudManagedDeployResult
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { getManagedVshudFenceEnvironmentId } from '../../../shared/remote-runtime/ssh/managed-vshud-ssh-owner'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { materializeVshudArtifact } from '../../vshud/artifact-slots/vshud-artifact-materializer'
import {
  closeVshudManagedTunnel,
  ensureVshudManagedTunnel,
  startVshudManagedTunnel
} from './vshud-managed-tunnel'
import { recoverInterruptedVshudActivation } from '../activation/vshud-activation-recovery'
import { wakeAlreadyActiveVshud } from './vshud-already-active-wake'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { resolveVshudRemoteContext, type VshudRemoteContext } from '../install/vshud-remote-context'
import { deployVshud } from '../install/vshud-remote-deploy'
import {
  adoptRunningVshudVersion,
  type VshudRunningAdoption
} from '../activation/vshud-running-version-adoption'
import { readLocalFullVersion } from '../install/remote-versioned-install'

import { VSHUD_ACTIVATION_POLICY_REFUSED_CODE } from '../activation/vshud-installed-activation'
import { pruneManagedVshudVersions } from './vshud-managed-version-gc'
import { tunneledVshudPairingCode } from './vshud-tunneled-pairing'
import { resolveVshudMigrationFence } from '../../ssh/migration-source/vshud-migration-source-fence'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import { findCollidingEnvironmentName } from '../../../shared/remote-runtime/host-catalog/runtime-environment-name-collision'
import { deployedVshudTunnelChecks } from './vshud-managed-tunnel-identity'
import {
  isForceableVshudDeferral,
  managedVshudDeployPolicy,
  managedVshudSlot,
  probeManagedVshudReadiness,
  requireManagedVshudInfrastructure
} from './vshud-managed-runtime-context'

export async function createManagedVshudEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    migration?: boolean
  }
): Promise<VshudManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedVshudInfrastructure()
    const environmentId =
      getManagedVshudFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    // Duplicate/name checks before an add: a crash-zeroed list (#18766) must read as empty here.
    const environments = await listEnvironments(userDataPath, { recoverBlankStore: true })
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (getVshudSshDeployment(registered)?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    const namesake = findCollidingEnvironmentName(
      environments.filter((entry) => entry.id !== environmentId),
      args.name
    )
    if (namesake) {
      throw new Error(`A server named "${namesake.name}" already exists.`)
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      ...(args.migration ? {} : { deployName: args.name }),
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.vshudProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error('The SSH registration for this host’s Vshu server has no durable generation.')
    }
    if (registered && getVshudSshDeployment(registered)?.sshTargetGeneration !== targetGeneration) {
      throw new Error('The saved Vshu server for this host has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveVshudRemoteContext(claimed, connection, args.signal)
      const slot = managedVshudSlot(context, VSHUD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedVshudActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readVshudActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        const current = await ensureVshudManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('This host’s Vshu server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(current),
          activeVersion
        }
      }
      const localVshudDir = await materializeVshudArtifact(context.serverTarget, {
        signal: args.signal
      })
      // Adopt before upload: only the paired incumbent can count terminals; redeploy would defer.
      const localVersion = readLocalFullVersion(localVshudDir)
      const adopted = args.force
        ? null
        : await adoptRunningVshudVersion(slot, context.activationRecord, localVersion)
      const { active } = context.activationRecord
      if (!adopted && !args.force && active && active !== localVersion) {
        // Wake may observe a peer's changed record; census admission must use that same record.
        context = { ...context, activationRecord: await readVshudActivationRecord(slot) }
      }
      const serving: DeployedVshud | VshudManagedDeferral =
        adopted ??
        (await deployOwnVshud(context, { ...slot, conn: connection }, localVshudDir, args))
      if ('outcome' in serving) {
        return serving
      }
      // Read the bound port: the preferred port may belong to another host process.
      const tunnel = deployedVshudTunnelChecks(serving.readiness, serving.reprobe)
      const localPort = await startVshudManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: VSHUD_MANAGED_REMOTE_PORT }
      )
      const environment = await addManagedVshudEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledVshudPairingCode(tunnel.readiness(), localPort),
        vshudDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: VSHUD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: serving.created ? 'created' : 'already-current',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: serving.version
      }
    } finally {
      if (!environmentRegistered) {
        await closeVshudManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

type DeployedVshud = VshudRunningAdoption & { created?: true }

async function deployOwnVshud(
  context: VshudRemoteContext<SshTarget>,
  slot: ReturnType<typeof managedVshudSlot>,
  localVshudDir: string,
  args: { force?: boolean; signal?: AbortSignal }
): Promise<DeployedVshud | VshudManagedDeferral> {
  const appVersion = getAppEnvironment().getVersion()
  const deployResult = await deployVshud({
    ...slot,
    localVshudDir,
    target: context.serverTarget,
    ...managedVshudDeployPolicy(context, appVersion, args.force ? 'force' : 'connect'),
    force: args.force,
    appVersion
  })
  if (deployResult.outcome === 'installed-not-activated') {
    return {
      outcome: 'deferred',
      candidateVersion: deployResult.fullVersion,
      code: deployResult.code,
      reason: deployResult.reason,
      forceable:
        isForceableVshudDeferral(deployResult) ||
        deployResult.code === VSHUD_ACTIVATION_POLICY_REFUSED_CODE
    }
  }
  if (deployResult.outcome === 'already-active') {
    await wakeAlreadyActiveVshud(slot)
  }
  const reprobe = () =>
    probeManagedVshudReadiness(context, localVshudDir, deployResult.fullVersion, args.signal)
  const readiness = await reprobe()
  await pruneManagedVshudVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployResult.fullVersion,
    readiness
  })
  return {
    version: deployResult.fullVersion,
    readiness,
    reprobe,
    ...(deployResult.outcome === 'already-active' ? {} : { created: true as const })
  }
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveVshudMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('vshud_migration_fence_required')
  }
}
