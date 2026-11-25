import type { WslHostDeferredUpdate } from '../../../shared/remote-runtime/wsl-hosts/wsl-host-types'
import type { WslVshudLaunch, WslVshudDeployOptions } from './wsl-vshud-launch-contract'
/** D1/D2b/D8 reuse SSH installation, activation journals/fences and admission over wsl.exe. C5 pairs through the reported loopback port. */
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'

import { VSHUD_MANAGED_REMOTE_PORT } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type { ServeReadiness } from '../../server/serve-readiness'

import { recoverInterruptedVshudActivation } from '../../managed-server/activation/vshud-activation-recovery'
import { readVshudActivationRecord } from '../../managed-server/activation/vshud-activation-record-store'
import { materializeVshudArtifact } from '../../vshud/artifact-slots/vshud-artifact-materializer'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import { VSHUD_ACTIVATION_POLICY_REFUSED_CODE } from '../../managed-server/activation/vshud-installed-activation'
import { vshudBoundPort } from '../../managed-server/lifecycle/vshud-managed-bound-port'
import {
  isForceableVshudDeferral,
  managedVshudDeployPolicy,
  managedVshudSlot
} from '../../managed-server/lifecycle/vshud-managed-runtime-context'
import { isWaitingVshudUpdateDeferral } from '../../managed-server/lifecycle/vshud-managed-auto-update'
import { clearVshudUpdateFailedThisLaunch } from '../../managed-server/lifecycle/vshud-managed-update-failure-memory'
import type { VshudUpdateIntent } from '../../managed-server/lifecycle/vshud-managed-update-decision'
import type { VshudActivationRecord } from '../../managed-server/activation/vshud-activation-record'
import { errorMessage } from '../../../shared/errors/error-message'
import { pruneWslVshudVersionsUntilClean } from './wsl-vshud-version-gc-memo'
import { pruneSupersededVshudCandidates } from '../../managed-server/lifecycle/vshud-managed-version-gc'
import { wakeAlreadyActiveVshud } from '../../managed-server/lifecycle/vshud-already-active-wake'
import { VshudActiveReadinessError } from '../../managed-server/activation/vshud-active-readiness'
import { WslDistroNotRunningError } from './wsl-vshud-connection-errors'
import {
  deployVshud,
  type VshudDeployOptions
} from '../../managed-server/install/vshud-remote-deploy'
import { isWslMoveUnderwayOnHost } from '../../persistence/moving-wsl-projects/orchestration/wsl-move-running-moves'
import { readLocalFullVersion } from '../../managed-server/install/remote-versioned-install'
import { createWslDistroHolder } from '../discovery/wsl-distro-holder'

import { defaultWslVshudEnvironmentId } from './wsl-vshud-environment-id'
import { readWslDistroRegistryIdShared } from '../discovery/wsl-distro-registry-id'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'
import { createWslVshudHostTransport } from './wsl-vshud-host-transport'
import { holdWslDistroWithContext } from './wsl-vshud-held-context'
import { deployWslVshudWithOneFence } from './wsl-vshud-one-fence-deploy'
import { removeFailedFreshWslVshudInstall } from './wsl-vshud-failed-install-removal'
import {
  probeWslActiveVshud,
  readWslVshudPid,
  type WslVshudLaunchMode
} from './wsl-vshud-active-probe'
import { relaunchAsWslHost } from './wsl-vshud-host-relaunch'
import { wslVshudConnectStateHints } from './wsl-vshud-connect-state-snapshot'
import { readWslVshudIncumbent, type WslVshudIncumbent } from './wsl-vshud-incumbent'
import { adoptUnrecordedWslVshud } from './wsl-vshud-instance-adoption'
import {
  admitWslVshudLaunch,
  readRestoredWslVshudRecord,
  recordWslVshudUpdateFailure,
  wslVshudDeferralCode,
  wslVshudDeferralFailure
} from './wsl-vshud-update-admission'
import { withOwnBuildLaunchEnv } from './wsl-vshud-own-build-launch-env'
import { WSL_NODE_RUNTIME_DOWNLOAD_BUDGET } from '../execution/wsl-node-runtime-download-budget'

/** Until the persisted deployment record (C7) assigns one, the environment is keyed per distro. */
export { defaultWslVshudEnvironmentId }

export async function deployAndLaunchWslVshud(
  distro: string,
  options: WslVshudDeployOptions = {}
): Promise<WslVshudLaunch> {
  const name = distro.trim()
  if (!name) {
    throw new Error('A WSL distro name is required')
  }
  const target: WslVshudHostTarget = {
    kind: 'wsl',
    id: options.environmentId ?? defaultWslVshudEnvironmentId(name),
    distro: name,
    label: options.label ?? name
  }
  const conn = options.createTransport?.(target) ?? createWslVshudHostTransport({ target })
  try {
    return await launchOverTransport(name, target, conn, options)
  } finally {
    conn.dispose?.()
  }
}

async function launchOverTransport(
  name: string,
  target: WslVshudHostTarget,
  transport: VshudHostTransport,
  options: WslVshudDeployOptions
): Promise<WslVshudLaunch> {
  const { signal } = options
  let ownBuildVersion: string | null = null
  // Set by the serving probe; readyLaunch reads the pid itself for any other version.
  let probed: { fullVersion: string; pid: number | null } | null = null
  const conn = withOwnBuildLaunchEnv(transport, () => ownBuildVersion)
  // Acquire a holder before launch or WSL can idle-stop vshud's distro.
  const holder = options.holder ?? createWslDistroHolder({ userDataPath: userDataPath() })
  // Read GUID alongside deploy; failure leaves the record without one.
  const distroId = (options.readRegistryId ?? readWslDistroRegistryIdShared)(name).catch(() => null)
  options.onStage?.('starting-distro')
  const first = await holdWslDistroWithContext(name, target, conn, holder, signal)
  const { held, connectState } = first
  let context = first.context
  const hints = wslVshudConnectStateHints(connectState, context.activationRecord)
  const slot = managedVshudSlot(context, VSHUD_MANAGED_REMOTE_PORT, signal)
  const recovery = await recoverInterruptedVshudActivation(slot, connectState ?? undefined)
  if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
    throw new Error(recovery.reason)
  }
  if (recovery.outcome === 'recovered') {
    context = { ...context, activationRecord: await readVshudActivationRecord(slot) }
  }
  // Adopt unrecorded vshud before deploy/wake or its instance lock blocks launch.
  const adoption = await adoptUnrecordedWslVshud(
    slot,
    context.activationRecord,
    undefined,
    hints.instanceLock(context.activationRecord)
  )
  if (adoption.outcome === 'adopted') {
    context = { ...context, activationRecord: adoption.record }
  }
  options.onStage?.('installing-server')
  const localVshudDir = await materializeVshudArtifact(context.serverTarget, {
    signal,
    trustVerificationRecord: true,
    ...(options.templateDir ? { templateDir: options.templateDir } : {})
  })
  const appVersion = getAppEnvironment().getVersion()
  const candidateVersion = readLocalFullVersion(localVshudDir)
  ownBuildVersion = candidateVersion
  const failureHost = { kind: 'wsl', id: target.id } as const
  const intent = options.intent ?? 'connect'
  const admit = (record: VshudActivationRecord, admitIntent: VshudUpdateIntent) =>
    admitWslVshudLaunch(
      {
        slot,
        record,
        candidateVersion,
        appVersion,
        host: failureHost,
        intent: admitIntent,
        moveRunning: isWslMoveUnderwayOnHost(userDataPath(), name)
      },
      name,
      readyLaunch
    )
  const admitted = await admit(context.activationRecord, intent)
  if ('outcome' in admitted) {
    return admitted
  }
  context = { ...context, activationRecord: admitted }
  const incumbentVersion = context.activationRecord.active
  // Only version changes need incumbent census; same-version connects deploy as no-ops.
  const incumbent: WslVshudIncumbent | null =
    incumbentVersion && incumbentVersion !== candidateVersion
      ? await (options.readIncumbent ?? readWslVshudIncumbent)({
          context,
          slot,
          paired: options.pairedOffer ?? null
        })
      : null
  const deployOnce = (extra: Partial<VshudDeployOptions>) =>
    deployVshud({
      ...slot,
      conn,
      localVshudDir,
      target: context.serverTarget,
      ...managedVshudDeployPolicy(context, appVersion, intent, options.pastUncountedTerminals),
      ...(incumbent
        ? {
            census: incumbent.census,
            recountCensus: incumbent.recount,
            releaseIncumbentAdmission: incumbent.releaseAdmission
          }
        : {}),
      // Only a confirmed Update anyway passes an uncounted census; plain Force defers it back to that confirm.
      force: options.pastUncountedTerminals ? true : intent === 'force' && 'live-terminals',
      appVersion,
      recordedNodeRuntimeProbe: true,
      localWslHost: true,
      nodeRuntimeDownload: WSL_NODE_RUNTIME_DOWNLOAD_BUDGET,
      onInstallLockWait: options.onInstallLockWait,
      ...extra
    }).catch((error: unknown) => {
      if (!signal?.aborted) {
        recordWslVshudUpdateFailure(failureHost, incumbentVersion, {
          code: 'vshud_update_failed',
          reason: errorMessage(error)
        })
      }
      throw error
    })
  const { deployed, woken } = await deployWslVshudWithOneFence(
    slot,
    deployOnce,
    hints.deployPreRead(context.activationRecord)
  )
  if (deployed.outcome === 'installed-not-activated') {
    await removeFailedFreshWslVshudInstall(slot, deployed)
    const failure = wslVshudDeferralFailure(deployed)
    recordWslVshudUpdateFailure(failureHost, incumbentVersion, failure)
    const restored =
      incumbentVersion && failure ? await readRestoredWslVshudRecord(slot, incumbentVersion) : null
    if (restored) {
      // After rollback proof, serve the restored incumbent on this connect too.
      const retried = await admit(restored, 'connect')
      if ('outcome' in retried) {
        return retried
      }
    }
    const deferredUpdate: WslHostDeferredUpdate = {
      candidateVersion: deployed.fullVersion,
      code: await wslVshudDeferralCode(slot, deployed, appVersion),
      reason: deployed.reason,
      incumbentVersion,
      forceable:
        isForceableVshudDeferral(deployed) || deployed.code === VSHUD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Live-terminal deferrals keep the incumbent serving until Update/Force.
    if (
      incumbentVersion &&
      incumbent?.readiness &&
      isWaitingVshudUpdateDeferral(deployed.code) &&
      // Another client may have activated since census; refuse stale incumbent assumptions.
      (await readVshudActivationRecord(slot)).active === incumbentVersion
    ) {
      const serving = {
        fullVersion: incumbentVersion,
        readiness: incumbent.readiness
      }
      await pruneSupersededVshudCandidates(slot, context.serverTarget, deployed.fullVersion)
      return { ...(await readyLaunch(serving)), deferredUpdate }
    }
    return { outcome: 'deferred', distro: name, ...deferredUpdate }
  }
  clearVshudUpdateFailedThisLaunch(failureHost)
  options.onStage?.('connecting')
  // A holder, not a let: control flow would not see the probe closure set it.
  const launch: { mode: WslVshudLaunchMode } = { mode: 'unknown' }
  const probe = async () => {
    const answer = await probeWslActiveVshud(context, localVshudDir, deployed.fullVersion, signal)
    probed = { fullVersion: deployed.fullVersion, pid: answer.pid }
    launch.mode = answer.launch
    return answer.readiness
  }
  let notWslHost: WslHostDeferredUpdate | null = null
  let readiness: ServeReadiness
  if (deployed.outcome === 'already-active') {
    // A stopped distro ended the active slot with it; the one-fence deploy already woke it.
    await (woken ? null : wakeAlreadyActiveVshud(slot))
    // Why once more: on a distro still booting, the vshud the wake saw serving can exit before
    // the probe; that is a stopped slot to start, not a failed connect.
    readiness = await probe().catch(async (error: unknown) => {
      if (!(error instanceof VshudActiveReadinessError) || error.verdict !== 'exited') {
        throw error
      }
      // A `wsl --shutdown` during a no-boot connect must not be undone by this second wake.
      if (options.requireRunning && !(await options.requireRunning())) {
        throw new WslDistroNotRunningError(name)
      }
      await wakeAlreadyActiveVshud(slot)
      return probe()
    })
    // Started without the WSL host marker (#43632): restart it as one when no terminal or chat runs.
    if (launch.mode === 'other') {
      const relaunch = await relaunchAsWslHost({
        environmentId: target.id,
        context,
        slot,
        fullVersion: deployed.fullVersion,
        paired: options.pairedOffer ?? null,
        moveRunning: isWslMoveUnderwayOnHost(userDataPath(), name),
        readIncumbent: options.readIncumbent,
        reprobe: async () => ({ readiness: await probe(), launch: launch.mode })
      })
      if (!relaunch.ready) {
        return { outcome: 'deferred', distro: name, ...relaunch.deferredUpdate }
      }
      readiness = relaunch.readiness ?? readiness
      notWslHost = relaunch.deferredUpdate
    }
  } else {
    readiness = await probe()
  }
  await pruneWslVshudVersionsUntilClean(target.id, {
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployed.fullVersion,
    readiness
  })
  const ready = await readyLaunch({ fullVersion: deployed.fullVersion, readiness })
  return notWslHost ? { ...ready, deferredUpdate: notWslHost } : ready

  async function readyLaunch(serving: {
    fullVersion: string
    readiness: ServeReadiness
  }): Promise<Extract<WslVshudLaunch, { outcome: 'ready' }>> {
    // The serving probe already read it; an admission that serves an incumbent did not.
    const pid =
      probed?.fullVersion === serving.fullVersion
        ? probed.pid
        : await readWslVshudPid(context, serving.fullVersion, signal)
    return {
      outcome: 'ready',
      distro: name,
      distroId: await distroId,
      port: vshudBoundPort(serving.readiness) ?? VSHUD_MANAGED_REMOTE_PORT,
      fullVersion: serving.fullVersion,
      pid,
      readiness: serving.readiness,
      holder: held.outcome,
      ...(adoption.outcome === 'adopted'
        ? { adoptedInstance: { version: adoption.version, pid: adoption.pid } }
        : {})
    }
  }
}

function userDataPath(): string {
  return getAppEnvironment().getPath('userData')
}
