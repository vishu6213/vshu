import {
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'

import type { VshudManagedRollbackResult } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { probeActiveVshudReadiness } from '../activation/vshud-active-readiness'
import { CURRENT_VSHUD_DAEMON_PROTOCOL } from '../activation/vshud-daemon-protocol-crossing'
import {
  managedVshudInstallDir,
  managedVshudSlot,
  resolveLinkedVshudContext
} from './vshud-managed-runtime-context'

import { readRemoteVshudBuildHash } from '../install/vshud-remote-build-hash'
import { rollbackVshud } from '../install/vshud-remote-rollback'
import { collectManagedTerminalCensus } from './vshud-terminal-census-client'
import { updateTerminalCounts } from '../activation/vshud-fenced-stop'
import { findIncompleteManagedVshudMigration } from './vshud-managed-migration-status'
import { latestVshudMigrationInto } from '../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-rollback-mark'
import { refreshMaintainedVshudPairing } from './vshud-maintenance-pairing-refresh'

import {
  type LifecycleArgs,
  withManagedVshudLifecycle,
  followLaunchedServerPort
} from './vshud-managed-lifecycle'

export async function rollbackManagedVshudEnvironment(
  userDataPath: string,
  args: LifecycleArgs
): Promise<VshudManagedRollbackResult> {
  return await withManagedVshudLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedVshudContext(environment, deployment, args.signal)
      const record = context.activationRecord
      const target = record.previous
      if (!target) {
        return {
          outcome: 'refused',
          code: 'vshud_rollback_no_target',
          reason: 'This server has no previous version to roll back to.'
        }
      }
      const crossing = migrationRollbackRefusal(userDataPath, environment, record.activatedAt)
      if (crossing) {
        return crossing
      }
      const slot = managedVshudSlot(context, deployment.remotePort, args.signal)
      const targetDir = managedVshudInstallDir(context, target)
      const targetBuildHash = await readRemoteVshudBuildHash(slot, targetDir)
      const { countFirst, ...recount } = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(userDataPath, environment, record, undefined, options)
      )
      // Recount under lock before rollback stop; this initial census closes no admission.
      const census = await countFirst()
      // Require idle because this client cannot prove the older build's daemon protocol attaches to live terminals.
      if (census.liveSessions !== 0) {
        return {
          outcome: 'refused',
          code:
            census.liveSessions === null
              ? 'vshud_rollback_census_unavailable'
              : 'vshud_rollback_terminals_running',
          reason:
            census.liveSessions === null
              ? 'The server did not answer how many terminals it runs. Retry when it answers.'
              : 'Close the terminals running on this server before rolling it back.'
        }
      }
      const result = await rollbackVshud({
        ...slot,
        record,
        census,
        ...recount,
        targetBuildHash,
        targetDaemonProtocol: CURRENT_VSHUD_DAEMON_PROTOCOL
      })
      if (result.outcome !== 'rolled-back') {
        return result
      }
      const readiness = await probeActiveVshudReadiness(
        { ...slot, remoteInstallDir: targetDir },
        { buildHash: targetBuildHash, fullVersion: result.target }
      )
      const updated = await refreshMaintainedVshudPairing(userDataPath, environment.id, readiness)
      await followLaunchedServerPort(userDataPath, environment.id)
      return {
        outcome: 'rolled-back',
        environment: redactRuntimeEnvironment(updated),
        activeVersion: result.target,
        discarded: result.discarded
      }
    }
  )
}

/** A post-activation migration is absent from the rollback snapshot; restoring it would discard imported state. */
function migrationRollbackRefusal(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  activatedAt: string | null
): VshudManagedRollbackResult | null {
  if (findIncompleteManagedVshudMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'vshud_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestVshudMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'vshud_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
