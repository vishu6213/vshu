/** Registered destinations must abort/prove empty, then unregister before fence release so later starts cannot reclaim the host. Never-registered destinations held nothing. */
import { removeManagedVshudEnvironment } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import { listEnvironments } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import { closeVshudManagedTunnel } from '../../lifecycle/vshud-managed-tunnel'
import {
  abortVshudMigrationCutover,
  type VshudMigrationAbortResult,
  type VshudMigrationCutoverContext,
  type VshudMigrationDestinationCatalog
} from './vshud-migration-cutover-coordinator'
import { findVshudMigrationSourceCutoverForTarget } from '../../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import {
  releaseVshudMigrationFence,
  releaseUndeployedMigrationFence
} from '../../../ssh/migration-source/vshud-migration-source-fence'

export async function abandonVshudConversion(args: {
  userDataPath: string
  store: VshudMigrationCutoverContext['store']
  claims: VshudMigrationCutoverContext['claims']
  targetId: string
  destinationFor: (environment: KnownRuntimeEnvironment) => VshudMigrationDestinationCatalog
}): Promise<VshudMigrationAbortResult | 'none'> {
  const cutover = findVshudMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Committed delta chains resolve only through the delta flow.
  if (!cutover || cutover.supersedesMigrationId) {
    return 'none'
  }
  const isRegistered = async (id: string): Promise<boolean> =>
    (await listEnvironments(args.userDataPath)).some((entry) => entry.id === id)
  const environment = (await listEnvironments(args.userDataPath)).find(
    (entry) => entry.id === cutover.destinationEnvironmentId
  )
  if (!environment) {
    await releaseUndeployedMigrationFence({ ...args, isDestinationRegistered: isRegistered })
    return 'none'
  }
  const context = { ...args, destination: args.destinationFor(environment) }
  return abortVshudMigrationCutover(context, cutover.migrationId, async (aborted) => {
    await closeVshudManagedTunnel(environment.id).catch(() => undefined)
    await removeManagedVshudEnvironment(args.userDataPath, environment.id)
    await releaseVshudMigrationFence(context, aborted)
  })
}
