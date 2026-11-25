import type { VshudManagedRuntimeStatus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import type { VshudActivationTransaction } from '../activation/vshud-activation-transaction'
import { readVshudActivationTransaction } from '../activation/vshud-activation-transaction-store'
import {
  requireManagedVshudEnvironment,
  resolveLinkedVshudContext
} from './vshud-managed-runtime-context'
import { currentManagedVshudUpdateDeferral } from './vshud-managed-update-deferrals'
import { findIncompleteManagedVshudMigration } from './vshud-managed-migration-status'
import { collectManagedTerminalCensus } from './vshud-terminal-census-client'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { bundledManagedVshudVersion } from './vshud-managed-auto-update'
import { availableManagedVshudUpdate } from './vshud-managed-update-decision'

/** Read host records without repairing them. */
export async function getManagedVshudRuntimeStatus(
  userDataPath: string,
  selector: string,
  signal?: AbortSignal
): Promise<VshudManagedRuntimeStatus> {
  const { environment, deployment } = await requireManagedVshudEnvironment(userDataPath, selector)
  const { status, record, serverTarget } = await runTargetLifecycle(
    deployment.sshTargetId,
    async () => {
      const context = await resolveLinkedVshudContext(environment, deployment, signal)
      const record = context.activationRecord
      const transaction = await readVshudActivationTransaction({
        conn: context.connection,
        host: context.host,
        remoteHome: context.remoteHome,
        signal
      })
      const status: VshudManagedRuntimeStatus = {
        environmentId: environment.id,
        sshTargetId: context.target.id,
        activeVersion: record.active,
        activeAppVersion: record.active ? (record.activeAppVersion ?? null) : null,
        previousVersion: record.previous,
        activatedAt: record.activatedAt,
        rollbackAvailable: Boolean(record.previous && record.snapshot),
        recovery: transaction ? managedRecoveryStatus(transaction) : null,
        terminals: await collectManagedTerminalCensus(userDataPath, environment, record),
        migration: migrationStatus(userDataPath, environment.id),
        deferredUpdate: currentManagedVshudUpdateDeferral(environment.id, record)
      }
      return { status, record, serverTarget: context.serverTarget }
    }
  )
  // Outside the host queue: hashing the local template must not hold up host actions.
  // A local template fault hides only the offer, never the host's status.
  const candidateVersion = await bundledManagedVshudVersion(serverTarget).catch(() => null)
  return {
    ...status,
    availableUpdate: availableManagedVshudUpdate({
      record,
      candidateVersion,
      appVersion: getAppEnvironment().getVersion(),
      deferredCandidateVersion: status.deferredUpdate?.candidateVersion ?? null
    })
  }
}

function managedRecoveryStatus(
  transaction: VshudActivationTransaction
): NonNullable<VshudManagedRuntimeStatus['recovery']> {
  switch (transaction.operation) {
    case 'activate':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.candidateVersion,
        startedAt: transaction.startedAt
      }
    case 'rollback':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.targetVersion,
        startedAt: transaction.startedAt
      }
    case 'decommission':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.activeVersion,
        startedAt: transaction.startedAt
      }
  }
}

function migrationStatus(
  userDataPath: string,
  environmentId: string
): VshudManagedRuntimeStatus['migration'] {
  const migration = findIncompleteManagedVshudMigration(userDataPath, environmentId)
  return migration
    ? { migrationId: migration.migrationId, phase: migration.phase, startedAt: migration.startedAt }
    : null
}
