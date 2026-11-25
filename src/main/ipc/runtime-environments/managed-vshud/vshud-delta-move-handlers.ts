/** IPC for a host an older build changed after conversion: move its newer projects, or keep the server's. */
import { ipcMain } from 'electron'
import type {
  VshudDeltaMovePreview,
  VshudDeltaMoveResult
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { listEnvironments } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import { requireManagedVshudInfrastructure } from '../../../managed-server/lifecycle/vshud-managed-runtime-context'
import { ensureVshudManagedTunnel } from '../../../managed-server/lifecycle/vshud-managed-tunnel'
import {
  keepVshudServerVersion,
  runVshudDeltaMove
} from '../../../managed-server/migration/cutover/vshud-migration-delta-move'
import { planVshudDeltaMove } from '../../../managed-server/migration/cutover/vshud-migration-delta-plan'
import { censusHostRelayTerminalsFor } from '../../../ssh/legacy-relay/endpoints/ssh-host-relay-census-for-target'
import {
  vshudMigrationDestinationFor,
  vshudServerAutomationEnablerFor
} from '../../../managed-server/lifecycle/vshud-runtime-conversion-wiring'
import { enableMovedVshudAutomationsForTarget } from '../../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-moved-automations'
import { requiredString } from './vshud-runtime-lifecycle-handlers'
import { publishResolvedChangedHostStatus } from './runtime-environment-managed-tunnel'
import { runTargetLifecycle } from '../../ssh/ssh-target-lifecycle-queue'

export function registerVshudDeltaMoveHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:previewVshudDeltaMove',
    (_event, args: { sshTargetId: string }): VshudDeltaMovePreview => {
      const { store, target } = requireChangedHost(args)
      const plan = planVshudDeltaMove(getUserDataPath(), store, target)
      const { sshTargetId, environmentId, added, notReflected, blockers } = plan
      return { sshTargetId, environmentId, added, notReflected, blockers }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:moveVshudDelta',
    async (_event, args: { sshTargetId: string }): Promise<VshudDeltaMoveResult> => {
      const userDataPath = getUserDataPath()
      const { store, claims, target } = requireChangedHost(args)
      const environment = (await listEnvironments(userDataPath)).find(
        (entry) => entry.id === target.vshudFence?.environmentId
      )
      if (!environment) {
        throw new Error('This host’s Vshu server is no longer registered.')
      }
      const result = await runVshudDeltaMove({
        userDataPath,
        store,
        claims,
        target,
        environment,
        connectDestination: async () =>
          vshudMigrationDestinationFor(
            await ensureVshudManagedTunnel(userDataPath, environment.id)
          ),
        censusHost: censusHostRelayTerminalsFor(target),
        runTargetLifecycle
      })
      if (result.outcome === 'moved') {
        // Tunnel repair may have re-paired the server; read its current credentials.
        const paired = (await listEnvironments(userDataPath)).find(
          (entry) => entry.id === environment.id
        )
        const automationsLeftDisabled = await enableMovedVshudAutomationsForTarget(
          userDataPath,
          target.id,
          vshudServerAutomationEnablerFor(paired ?? environment)
        ).catch((error: unknown) => {
          console.warn('[ssh] Could not re-enable moved automations:', error)
          return 0
        })
        publishResolvedChangedHostStatus(target, environment.id, automationsLeftDisabled)
      }
      return result
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:keepVshudServerVersion',
    async (_event, args: { sshTargetId: string }): Promise<void> => {
      const { store, claims, target, environmentId } = requireChangedHost(args)
      await runTargetLifecycle(target.id, () =>
        keepVshudServerVersion({ userDataPath: getUserDataPath(), store, claims, target })
      )
      publishResolvedChangedHostStatus(target, environmentId)
    }
  )
}

function requireChangedHost(args: { sshTargetId: string } | undefined) {
  const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
  const { targetStore, claims } = requireManagedVshudInfrastructure()
  const store = targetStore.getVshudMigrationSource()
  const target = store.getSshTarget(sshTargetId)
  if (!target?.vshudFence?.sourceChangedAt) {
    throw new Error('This SSH host has no changes from an older Vshu to resolve.')
  }
  return { store, claims, target, environmentId: target.vshudFence.environmentId }
}
