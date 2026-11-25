import {
  isRetainedVshudMigrationSourceCutover,
  type VshudMigrationSourceCutover
} from '../../../shared/vshud-migration/vshud-migration-source-cutover'
import {
  getVshudSshDeployment,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { listVshudMigrationSourceCutovers } from '../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'

type VshudManagedPendingMigration = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: VshudMigrationSourceCutover['phase']
  startedAt: string
}

/** Unreadable journals must not look like absent migrations. */
export function listPendingManagedVshudMigrations(
  userDataPath: string
): VshudManagedPendingMigration[] {
  return (
    listVshudMigrationSourceCutovers(userDataPath)
      // Committed/retained journals preserve downgrade recovery, not pending migration work.
      .filter(
        (cutover) =>
          cutover.phase !== 'source-retired' && !isRetainedVshudMigrationSourceCutover(cutover)
      )
      .map((cutover) => ({
        migrationId: cutover.migrationId,
        environmentId: cutover.destinationEnvironmentId,
        name: cutover.destinationName,
        sshTargetId: cutover.sshTargetId,
        phase: cutover.phase,
        startedAt: cutover.startedAt
      }))
  )
}

export function findIncompleteManagedVshudMigration(
  userDataPath: string,
  environmentId: string
): VshudManagedPendingMigration | null {
  return (
    listPendingManagedVshudMigrations(userDataPath).find(
      (migration) => migration.environmentId === environmentId
    ) ?? null
  )
}

export function environmentMatchesManagedVshudCutover(
  environment: KnownRuntimeEnvironment,
  cutover: VshudMigrationSourceCutover
): boolean {
  const deployment = getVshudSshDeployment(environment)
  return (
    environment.id === cutover.destinationEnvironmentId &&
    environment.name === cutover.destinationName &&
    deployment?.sshTargetId === cutover.sshTargetId &&
    deployment.sshTargetGeneration === cutover.sshTargetGeneration
  )
}
