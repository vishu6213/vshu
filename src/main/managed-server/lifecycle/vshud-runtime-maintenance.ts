import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { redactRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type {
  VshudManagedDeployResult,
  VshudManagedPastLiveTerminals
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'

import { materializeVshudArtifact } from '../../vshud/artifact-slots/vshud-artifact-materializer'
import { wakeAlreadyActiveVshud } from './vshud-already-active-wake'
import {
  clearManagedVshudUpdateDeferral,
  recordManagedVshudUpdateDeferral
} from './vshud-managed-update-deferrals'

import {
  isForceableVshudDeferral,
  managedVshudSlot,
  probeManagedVshudReadiness,
  resolveLinkedVshudContext
} from './vshud-managed-runtime-context'

import type { requireManagedVshudEnvironment } from './vshud-managed-runtime-context'

import type { VshudRemoteContext } from '../install/vshud-remote-context'
import { deployVshud } from '../install/vshud-remote-deploy'
import type { VshudDeployOptions } from '../install/vshud-remote-deploy'
import type { VshudUpdateForce } from '../activation/vshud-update-plan'
import { VSHUD_ACTIVATION_POLICY_REFUSED_CODE } from '../activation/vshud-installed-activation'
import {
  pruneManagedVshudVersions,
  pruneSupersededVshudCandidates
} from './vshud-managed-version-gc'

import { clearVshudUpdateFailedThisLaunch } from './vshud-managed-update-failure-memory'
import { admitVshudRecordForIntent } from './vshud-managed-update-decision'
import { collectManagedTerminalCensus } from './vshud-terminal-census-client'
import { updateTerminalCounts } from '../activation/vshud-fenced-stop'
import { refreshMaintainedVshudPairing } from './vshud-maintenance-pairing-refresh'
import type { LifecycleArgs } from './vshud-managed-lifecycle'
import { withManagedVshudLifecycle, followLaunchedServerPort } from './vshud-managed-lifecycle'

export async function updateManagedVshudEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { force?: boolean; pastLiveTerminals?: VshudManagedPastLiveTerminals }
): Promise<VshudManagedDeployResult> {
  const { pastLiveTerminals } = args
  // Update anyway keeps Update's version admission even if a caller also passed force.
  const intent = args.force && !pastLiveTerminals ? 'force' : 'update'
  return await withManagedVshudLifecycle(userDataPath, args.selector, async (managed) => {
    const admitIntent = admitVshudRecordForIntent(intent, getAppEnvironment().getVersion())
    // Checked under the host fence: another desktop may have activated a build since the confirm.
    const admitRecord: NonNullable<VshudDeployOptions['admitRecord']> = pastLiveTerminals
      ? (record, candidateVersion) =>
          record.active !== pastLiveTerminals.incumbentVersion
            ? "This host's server changed since the update was confirmed. Review it and update again."
            : admitIntent(record, candidateVersion)
      : admitIntent
    const force: VshudUpdateForce | undefined = pastLiveTerminals ? 'live-terminals' : args.force
    const result = await runManagedVshudUpdate(
      userDataPath,
      managed,
      await resolveLinkedVshudContext(managed.environment, managed.deployment, args.signal),
      { signal: args.signal, force, admitRecord }
    )
    // A completed manual update clears automatic failure suppression; deferred attempts do not.
    if (result.outcome !== 'deferred') {
      clearVshudUpdateFailedThisLaunch({ kind: 'ssh', id: managed.deployment.sshTargetId })
    }
    return result
  })
}

export async function runManagedVshudUpdate(
  userDataPath: string,
  { environment, deployment }: Awaited<ReturnType<typeof requireManagedVshudEnvironment>>,
  context: VshudRemoteContext,
  args: {
    force?: VshudUpdateForce
    signal?: AbortSignal
    localVshudDir?: string
    admitRecord?: VshudDeployOptions['admitRecord']
  }
): Promise<VshudManagedDeployResult> {
  const { countFirst, ...recount } = updateTerminalCounts((options) =>
    collectManagedTerminalCensus(
      userDataPath,
      environment,
      context.activationRecord,
      undefined,
      options
    )
  )
  const census = await countFirst()
  const localVshudDir =
    args.localVshudDir ??
    (await materializeVshudArtifact(context.serverTarget, { signal: args.signal }))
  const slot = managedVshudSlot(context, deployment.remotePort, args.signal)
  const result = await deployVshud({
    ...slot,
    localVshudDir,
    target: context.serverTarget,
    census,
    ...recount,
    censusRecord: context.activationRecord,
    force: args.force,
    appVersion: getAppEnvironment().getVersion(),
    ...(args.admitRecord ? { admitRecord: args.admitRecord } : {})
  })
  if (result.outcome === 'installed-not-activated') {
    const deferral = {
      outcome: 'deferred' as const,
      candidateVersion: result.fullVersion,
      code: result.code,
      reason: result.reason,
      // Force may override policy deferrals, including a newer host build.
      forceable:
        isForceableVshudDeferral(result.code) ||
        result.code === VSHUD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Policy refusal is final for this host, not a transient update to retry.
    if (result.code !== VSHUD_ACTIVATION_POLICY_REFUSED_CODE) {
      recordManagedVshudUpdateDeferral(environment.id, deferral, context.activationRecord)
    }
    await pruneSupersededVshudCandidates(slot, context.serverTarget, result.fullVersion)
    return deferral
  }
  clearManagedVshudUpdateDeferral(environment.id)
  const alreadyActive = result.outcome === 'already-active'
  const managed = { environmentId: environment.id, hostLabel: context.target.label }
  const started = alreadyActive && (await wakeAlreadyActiveVshud(slot, managed))
  const readiness = await probeManagedVshudReadiness(
    context,
    localVshudDir,
    result.fullVersion,
    args.signal
  )
  await pruneManagedVshudVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: result.fullVersion,
    readiness
  })
  const updated = await refreshMaintainedVshudPairing(userDataPath, environment.id, readiness)
  if (started || result.outcome !== 'already-active') {
    await followLaunchedServerPort(userDataPath, environment.id)
  }
  return {
    outcome: result.outcome === 'already-active' ? 'already-current' : 'updated',
    environment: redactRuntimeEnvironment(updated),
    activeVersion: result.fullVersion
  }
}
