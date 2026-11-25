// Keep claims, tunnels and registration until the host proves server exit.
import type {
  VshudManagedCancelStopResult,
  VshudManagedForgetResult,
  VshudManagedStopResult
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type { VshudDaemonRetirementVerdict } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { removeManagedVshudEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findManagedSshTwin } from '../../../shared/remote-runtime/host-catalog/runtime-environment-host-key-match'
import type {
  KnownRuntimeEnvironment,
  VshudSshDeploymentLink
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { recoverInterruptedVshudActivation } from '../activation/vshud-activation-recovery'
import { withStaleVshudActivationRecoveryLock } from '../activation/vshud-activation-lock'
import { readVshudActivationTransaction } from '../activation/vshud-activation-transaction-store'
import { reconcileVshudDecommission } from './vshud-decommission-recovery'
import { cancelRemoteVshudManagedStop } from './vshud-managed-remote-stop'
import {
  managedVshudSlot,
  requireManagedVshudInfrastructure,
  resolveLinkedVshudContext
} from './vshud-managed-runtime-context'
import { closeVshudManagedTunnel, ensureVshudManagedTunnel } from './vshud-managed-tunnel'
import { clearManagedVshudUpdateDeferral } from './vshud-managed-update-deferrals'
import { removeVshudMigrationJournalsForDestination } from '../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import { decommissionRemoteVshud } from '../install/vshud-remote-decommission'
import { withManagedVshudLifecycle } from './vshud-managed-lifecycle'
import { collectManagedTerminalCensus } from './vshud-terminal-census-client'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'

type ManagedVshudStopPolicy = {
  isActiveEnvironment: (environmentId: string) => boolean
  retireLocalState: (environmentId: string) => Promise<void> | void
  /** Runs inside the host's lifecycle, so a Connect queued behind the unlink still wins. */
  releaseHostTransport: (sshTargetId: string) => Promise<void>
}

type Refusal = Extract<VshudManagedStopResult, { outcome: 'refused' }>
type Stopped = { version: string | null; retirement: VshudDaemonRetirementVerdict | null }

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

export async function stopManagedVshudEnvironment(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal },
  policy: ManagedVshudStopPolicy
): Promise<VshudManagedStopResult> {
  return await withManagedVshudLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'vshud_stop_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before stopping it.'
      )
    }
    const stopped = await stopRemote(userDataPath, environment, deployment, args.signal)
    if ('outcome' in stopped) {
      return stopped
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId,
      stoppedVersion: stopped.version,
      retirement: stopped.retirement
    }
  })
}

/** Forget local state without assuming host exit; later connects may relink a still-running server. */
export async function forgetManagedVshudEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedVshudStopPolicy
): Promise<VshudManagedForgetResult> {
  return await withManagedVshudLifecycle(userDataPath, args.selector, (managed) =>
    forgetLinkedEnvironment(userDataPath, managed, policy)
  )
}

/** Forget one of two saved entries for one managed server; the other keeps managing it, so the host is not contacted. */
export async function forgetRedundantManagedVshudEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedVshudStopPolicy
): Promise<VshudManagedForgetResult> {
  return await withManagedVshudLifecycle(userDataPath, args.selector, async (managed) => {
    // Checked in the queue and unlinked in the same tick, so two Removes cannot each count the other as the twin.
    if (!findManagedSshTwin(await listEnvironments(userDataPath), managed.environment)) {
      return refuse(
        'live',
        'vshud_forget_no_managed_twin',
        'No other saved entry manages this server anymore, so removing this one would leave it unmanaged. Stop it instead.'
      )
    }
    return forgetLinkedEnvironment(userDataPath, managed, policy)
  })
}

async function forgetLinkedEnvironment(
  userDataPath: string,
  {
    environment,
    deployment
  }: { environment: KnownRuntimeEnvironment; deployment: VshudSshDeploymentLink },
  policy: ManagedVshudStopPolicy
): Promise<VshudManagedForgetResult> {
  if (policy.isActiveEnvironment(environment.id)) {
    return refuse(
      'live',
      'vshud_forget_active_environment',
      'This server is the default host for new projects. Choose another one under New projects open on before forgetting it.'
    )
  }
  await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
  return {
    outcome: 'forgotten',
    verdict: 'unverifiable',
    environmentId: environment.id,
    sshTargetId: deployment.sshTargetId
  }
}

async function stopRemote(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: VshudSshDeploymentLink,
  signal?: AbortSignal,
  retried = false
): Promise<Stopped | Refusal> {
  const context = await resolveLinkedVshudContext(environment, deployment, signal)
  const slot = managedVshudSlot(context, deployment.remotePort, signal)
  const transaction = await readVshudActivationTransaction(slot)
  if (transaction?.operation === 'decommission') {
    // Resume the exact interrupted stop from its journal.
    const recovered = await recoverInterruptedVshudActivation(slot)
    if (recovered.outcome === 'recovered' && recovered.activeVersion === null) {
      return { version: transaction.activeVersion, retirement: null }
    }
    if (recovered.outcome === 'refused') {
      return refuse(recovered.verdict, recovered.code, recovered.reason)
    }
    if (recovered.outcome === 'pending') {
      return refuse('unverifiable', recovered.code, recovered.reason)
    }
    // Another run may settle recovery first; restart from its resulting record.
    if (recovered.outcome === 'none') {
      return retried
        ? refuse(
            'unverifiable',
            'vshud_stop_journal_changed',
            'Another run on this server changed its stop while this one waited. Refresh and retry.'
          )
        : stopRemote(userDataPath, environment, deployment, signal, true)
    }
    return refuse(
      'live',
      'vshud_stop_withdrawn',
      'The interrupted stop was withdrawn and the server keeps serving. Stop it again.'
    )
  }
  if (transaction) {
    return refuse(
      'unverifiable',
      'vshud_activation_recovery_required',
      'An earlier update on this server was interrupted. Recover it before stopping.'
    )
  }
  const record = context.activationRecord
  if (!record.active) {
    return { version: null, retirement: null }
  }
  const census = await collectManagedTerminalCensus(userDataPath, environment, record)
  const result = await decommissionRemoteVshud({ ...slot, record, census })
  if (result.outcome === 'refused') {
    return refuse(result.verdict, result.code, result.reason)
  }
  return { version: result.version, retirement: result.retirement }
}

async function unlinkEnvironmentLocally(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: VshudSshDeploymentLink,
  policy: ManagedVshudStopPolicy
): Promise<void> {
  // Remove registration before releasing claims so crashes leave a resumable hidden target.
  await removeManagedVshudEnvironment(userDataPath, environment.id)
  await policy.retireLocalState(environment.id)
  await closeVshudManagedTunnel(environment.id)
  const { claims } = requireManagedVshudInfrastructure()
  claims.releaseForUserRemoval(deployment.sshTargetId, environment.id)
  clearManagedVshudUpdateDeferral(environment.id)
  await claims.flush()
  // Clear journals after the fence; stale leftovers are recoverable on later conversion.
  removeVshudMigrationJournalsForDestination(userDataPath, deployment.sshTargetId, environment.id)
  // No server serves the host now, and an unserved host never stays connected.
  await policy.releaseHostTransport(deployment.sshTargetId)
}

export async function cancelManagedVshudStop(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal }
): Promise<VshudManagedCancelStopResult> {
  return await withManagedVshudLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    const context = await resolveLinkedVshudContext(environment, deployment, args.signal)
    const slot = managedVshudSlot(context, deployment.remotePort, args.signal)
    let result: VshudManagedCancelStopResult
    try {
      result = await withStaleVshudActivationRecoveryLock(slot, async (lock) => {
        const transaction = await readVshudActivationTransaction(slot)
        if (transaction?.operation !== 'decommission') {
          if (transaction) {
            lock.retain()
          }
          return { outcome: 'none' }
        }
        if (transaction.phase === 'process-exited') {
          lock.retain()
          return { outcome: 'already-stopped' }
        }
        if (transaction.request) {
          const cancellation = await cancelRemoteVshudManagedStop(slot, transaction.request)
          if (cancellation.outcome !== 'canceled') {
            lock.retain()
            return {
              outcome: 'refused',
              verdict: 'live',
              code: 'vshud_stop_already_dispatched',
              reason: 'vshud already acted on the stop and is shutting down; it cannot be canceled.'
            }
          }
        }
        const kept = await reconcileVshudDecommission(slot, {
          action: 'keep-serving',
          version: transaction.activeVersion
        })
        if (kept.outcome !== 'recovered' || !kept.activeVersion) {
          lock.retain()
          return {
            outcome: 'refused',
            verdict: 'unverifiable',
            code: 'vshud_stop_cancel_unverifiable',
            reason: 'The stop was withdrawn but the server could not be shown to be serving.'
          }
        }
        return { outcome: 'canceled', activeVersion: kept.activeVersion }
      })
    } catch (error) {
      if (error instanceof RemoteInstallLockBusyError) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'vshud_stop_still_running',
          reason: 'A stop on this server may still be running. Retry after it settles.'
        }
      }
      throw error
    }
    if (result.outcome === 'canceled') {
      await ensureVshudManagedTunnel(userDataPath, environment.id)
    }
    return result
  })
}
