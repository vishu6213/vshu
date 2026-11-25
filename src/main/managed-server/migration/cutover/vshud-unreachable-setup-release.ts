/** Release conversion setups stranded before staging by refused SSH forwarding. Stop any activated slot, unregister, then use undeployed-fence release; source rows remain intact for retry. */
import { listEnvironments } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import { removeManagedVshudEnvironment } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import { findVshudMigrationSourceCutoverForTarget } from '../../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import { releaseUndeployedMigrationFence } from '../../../ssh/migration-source/vshud-migration-source-fence'
import { closeVshudManagedTunnel } from '../../lifecycle/vshud-managed-tunnel'
import type { SshTargetVshudClaims } from '../../../ssh/targets/ssh-target-vshud-claims'
import { withVshudActivationLock } from '../../activation/vshud-activation-lock'
import { withDeactivatedVersionCommitted } from '../../activation/vshud-activation-record'
import {
  readVshudActivationRecord,
  writeVshudActivationRecord
} from '../../activation/vshud-activation-record-store'
import { managedVshudSlot } from '../../lifecycle/vshud-managed-runtime-context'
import { resolveVshudRemoteContext } from '../../install/vshud-remote-context'
import { vshudStopFreedTheHost } from '../../install/vshud-remote-process-control'
import { vshudSlotDir, stopVshudSlot } from '../../activation/vshud-recovery-slot'

import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../../ssh/targets/ssh-target-registry'
import { errorMessage } from '../../../../shared/errors/error-message'

export async function releaseUnreachableVshudSetup(args: {
  userDataPath: string
  claims: SshTargetVshudClaims
  targetId: string
  signal?: AbortSignal
}): Promise<void> {
  const cutover = findVshudMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Staged/committed destinations require their own evidence before release.
  if (cutover?.phase !== 'source-fenced') {
    return
  }
  const environmentId = cutover.destinationEnvironmentId
  await closeVshudManagedTunnel(environmentId).catch(() => undefined)
  await stopStrandedVshud(args.targetId, args.signal).catch((error: unknown) => {
    console.warn(`[vshud] Could not stop the unreachable setup's server: ${errorMessage(error)}`)
  })
  const isRegistered = async (id: string): Promise<boolean> =>
    (await listEnvironments(args.userDataPath)).some((entry) => entry.id === id)
  // Unregister first so an interrupted release leaves a recoverable undeployed fence.
  if (await isRegistered(environmentId)) {
    await removeManagedVshudEnvironment(args.userDataPath, environmentId)
  }
  await releaseUndeployedMigrationFence({
    userDataPath: args.userDataPath,
    claims: args.claims,
    targetId: args.targetId,
    isDestinationRegistered: isRegistered,
    signal: args.signal
  })
}

/** Clear active only after proven slot exit; daemon terminals may outlive it. */
async function stopStrandedVshud(targetId: string, signal?: AbortSignal): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  const connectionManager = getSshConnectionManager()
  if (!target || !connectionManager) {
    return
  }
  const context = await resolveVshudRemoteContext(
    target,
    await connectionManager.connect(target),
    signal
  )
  if (!context.activationRecord.active) {
    return
  }
  // Port is irrelevant because this recovery never launches a slot.
  const slot = managedVshudSlot(context, 0, signal)
  await withVshudActivationLock(
    slot,
    async () => {
      const record = await readVshudActivationRecord(slot)
      if (!record.active) {
        return
      }
      const stopped = await stopVshudSlot(slot, vshudSlotDir(slot, record.active), false)
      if (vshudStopFreedTheHost(stopped)) {
        await writeVshudActivationRecord(slot, withDeactivatedVersionCommitted(record))
      }
    },
    () => undefined
  )
}
