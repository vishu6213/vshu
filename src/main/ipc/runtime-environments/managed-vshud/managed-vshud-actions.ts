import {
  cancelManagedVshudStop,
  forgetManagedVshudEnvironment,
  forgetRedundantManagedVshudEnvironment,
  stopManagedVshudEnvironment
} from '../../../managed-server/lifecycle/vshud-runtime-decommission'
import { getManagedVshudRuntimeStatus } from '../../../managed-server/lifecycle/vshud-runtime-status'
import { recoverManagedVshudEnvironment } from '../../../managed-server/lifecycle/vshud-managed-recovery'
import { rollbackManagedVshudEnvironment } from '../../../managed-server/lifecycle/vshud-managed-rollback'
import { updateManagedVshudEnvironment } from '../../../managed-server/lifecycle/vshud-runtime-maintenance'
import { getVshudSshDeployment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import { resolveEnvironment } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import type {
  VshudManagedRestartResult,
  VshudManagedStaleLockReclaimRequest,
  VshudManagedStaleLockReclaimResult
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { restartManagedVshudEnvironment } from '../../../managed-server/lifecycle/vshud-managed-launch-session'
import { forgetManagedVshudAutomaticFailures } from '../../../managed-server/lifecycle/vshud-managed-tunnel'
import { runManagedVshudStaleLockReclaim } from '../../../managed-server/lifecycle/vshud-managed-stale-lock-reclaim'
import { clearLaunchSessionNote } from './runtime-environment-managed-tunnel'
import { forgetLaunchSessionVerdict } from '../../ssh/ssh-host-launch-session-note'
import {
  liftUserHoldsForServerAction,
  resumeRuntimeEnvironmentStatus
} from '../../ssh/ssh-host-user-disconnect'
import { releaseUnlinkedHostTransport } from '../../ssh/ssh-session-teardown'
import type { ManagedServerActions } from '../../../runtime/hosts/management/managed-server-actions-registry'
import {
  retireRemovedRuntimeEnvironment,
  type RemovedServerStore
} from '../catalog/runtime-environment-removal-cleanup'

export type ManagedVshudActionOptions = {
  getUserDataPath: () => string
  getActiveEnvironmentId: () => string | null | undefined
  invalidateTransport: (environmentId: string) => Promise<void> | void
  clearHostServerNotes: (sshTargetId: string, environmentId: string) => void
  clearHostServerStatus: (sshTargetId: string) => void
  store: RemovedServerStore
}

export function createManagedVshudActions(
  options: ManagedVshudActionOptions
): ManagedServerActions {
  const userDataPath = options.getUserDataPath
  const unlinkPolicy = {
    isActiveEnvironment: (environmentId: string) =>
      options.getActiveEnvironmentId() === environmentId,
    retireLocalState: (environmentId: string) =>
      retireRemovedRuntimeEnvironment(
        environmentId,
        options.invalidateTransport,
        options.store,
        userDataPath()
      ),
    releaseHostTransport: releaseUnlinkedHostTransport
  }
  return {
    status: (selector) => getManagedVshudRuntimeStatus(userDataPath(), selector),
    update: (selector, force, pastLiveTerminals) =>
      asExplicitServerAction(userDataPath(), selector, async () => {
        const result = await updateManagedVshudEnvironment(userDataPath(), {
          selector,
          force,
          ...(pastLiveTerminals ? { pastLiveTerminals } : {})
        })
        if (result.outcome === 'updated') {
          await options.invalidateTransport(result.environment.id)
        }
        if (result.outcome !== 'deferred') {
          const targetId = getVshudSshDeployment(result.environment)?.sshTargetId
          if (targetId) {
            options.clearHostServerNotes(targetId, result.environment.id)
          }
        }
        return result
      }),
    rollback: (selector) =>
      asExplicitServerAction(userDataPath(), selector, async () => {
        const result = await rollbackManagedVshudEnvironment(userDataPath(), { selector })
        if (result.outcome === 'rolled-back') {
          await options.invalidateTransport(result.environment.id)
        }
        return result
      }),
    recover: (selector, acceptChangedState) =>
      asExplicitServerAction(userDataPath(), selector, async () => {
        const result = await recoverManagedVshudEnvironment(userDataPath(), {
          selector,
          acceptChangedState: acceptChangedState === true
        })
        if (result.outcome === 'recovered' && result.activeVersion) {
          await options.invalidateTransport(result.environment.id)
        }
        return result
      }),
    stop: async (selector) => {
      const result = await stopManagedVshudEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'unlinked') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    cancelStop: async (selector) => await cancelManagedVshudStop(userDataPath(), { selector }),
    forget: async (selector) => {
      const result = await forgetManagedVshudEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    forgetRedundant: async (selector) => {
      const result = await forgetRedundantManagedVshudEnvironment(
        userDataPath(),
        { selector },
        unlinkPolicy
      )
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    }
  }
}

export async function restartManagedVshud(
  options: ManagedVshudActionOptions,
  selector: string
): Promise<VshudManagedRestartResult> {
  return asExplicitServerAction(options.getUserDataPath(), selector, async () => {
    const result = await restartManagedVshudEnvironment(options.getUserDataPath(), selector)
    if (result.outcome === 'restarted') {
      await reconnectRestartedManagedVshud(options, result.environmentId)
    }
    return result
  })
}

export async function reclaimManagedVshudStaleLock(
  options: ManagedVshudActionOptions,
  selector: string,
  request: VshudManagedStaleLockReclaimRequest
): Promise<VshudManagedStaleLockReclaimResult> {
  const result = await runManagedVshudStaleLockReclaim(options.getUserDataPath(), selector, request)
  // Reconnect also replaces stale-lock feedback when no process had started.
  if (result.status === 'reclaimed') {
    await reconnectRestartedManagedVshud(options, result.environmentId)
  }
  return result
}

async function reconnectRestartedManagedVshud(
  options: ManagedVshudActionOptions,
  environmentId: string
): Promise<void> {
  await options.invalidateTransport(environmentId)
  const environment = await resolveEnvironment(options.getUserDataPath(), environmentId)
  const targetId = getVshudSshDeployment(environment)?.sshTargetId
  if (targetId) {
    options.clearHostServerNotes(targetId, environmentId)
    forgetLaunchSessionVerdict(targetId)
    clearLaunchSessionNote(targetId, environmentId)
  }
}

/** A user's Update, Rollback, Recover or Restart is a Connect: it re-arms automatic starts and lifts a Disconnect. */
async function asExplicitServerAction<T>(
  userDataPath: string,
  selector: string,
  action: () => Promise<T>
): Promise<T> {
  let lifted: string[] = []
  try {
    const environment = await resolveEnvironment(userDataPath, selector)
    forgetManagedVshudAutomaticFailures(userDataPath, environment.id)
    lifted = await liftUserHoldsForServerAction(environment)
  } catch {
    // An unknown selector fails in the action itself with its own error.
  }
  try {
    // `action` includes its transport invalidation, so resumed status never probes the old transport.
    return await action()
  } finally {
    await resumeLiftedStatus(lifted)
  }
}

async function resumeLiftedStatus(environmentIds: readonly string[]): Promise<void> {
  try {
    await resumeRuntimeEnvironmentStatus(environmentIds)
  } catch (error) {
    // A server removed during the action has no status to resume; keep the action's own result.
    console.warn('[managed-vshud] Could not resume status after an explicit action:', error)
  }
}
