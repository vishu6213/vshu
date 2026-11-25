import { redactRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { VshudManagedRecoveryResult } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { recoverInterruptedVshudActivation } from '../activation/vshud-activation-recovery'
import { managedVshudSlot, resolveLinkedVshudContext } from './vshud-managed-runtime-context'

import { refreshMaintainedVshudPairing } from './vshud-maintenance-pairing-refresh'
import type { LifecycleArgs } from './vshud-managed-lifecycle'
import { withManagedVshudLifecycle, followLaunchedServerPort } from './vshud-managed-lifecycle'

export async function recoverManagedVshudEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { acceptChangedState?: boolean }
): Promise<VshudManagedRecoveryResult> {
  return await withManagedVshudLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedVshudContext(environment, deployment, args.signal)
      const result = await recoverInterruptedVshudActivation({
        ...managedVshudSlot(context, deployment.remotePort, args.signal),
        acceptChangedState: args.acceptChangedState === true
      })
      if (result.outcome !== 'recovered') {
        return result
      }
      const updated = result.readiness
        ? await refreshMaintainedVshudPairing(userDataPath, environment.id, result.readiness)
        : environment
      if (result.activeVersion) {
        await followLaunchedServerPort(userDataPath, environment.id)
      }
      return {
        outcome: 'recovered',
        resolution: result.resolution,
        activeVersion: result.activeVersion,
        environment: redactRuntimeEnvironment(updated)
      }
    }
  )
}
