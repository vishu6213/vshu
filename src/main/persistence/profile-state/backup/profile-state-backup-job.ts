import { toNamespacedPath } from 'node:path'
import { openProfileStateDatabaseReadOnly } from '../database/profile-state-database'
import { writeProfileStateDatabaseSnapshotAsync } from '../database/profile-state-database-snapshot'
import { validateProfileStateSnapshot } from '../documents/profile-state-documents'

export type ProfileStateBackupJob = {
  databasePath: string
  profileId: string
  targetPath: string
  temporaryPath?: string
}

/** Retain connections through snapshot copy and strict validation. */
export async function writeProfileStateBackup(job: ProfileStateBackupJob): Promise<void> {
  // SQLite's Windows VFS cannot open paths past MAX_PATH, and the owner-scoped staging name adds
  // ~120 characters, so a deep userData directory failed every backup with "unable to open
  // database file". Namespaced (\?\) paths lift the limit; on POSIX this returns paths unchanged.
  const opened = openProfileStateDatabaseReadOnly(toNamespacedPath(job.databasePath), job.profileId)
  const temporaryPath = job.temporaryPath && toNamespacedPath(job.temporaryPath)
  try {
    await writeProfileStateDatabaseSnapshotAsync(opened.db, toNamespacedPath(job.targetPath), {
      temporaryPath,
      validateStagedSnapshot: (stagingPath) =>
        validateProfileStateBackup(stagingPath, job.profileId)
    })
  } finally {
    opened.db.close()
  }
}

function validateProfileStateBackup(path: string, profileId: string): void {
  const snapshot = openProfileStateDatabaseReadOnly(path, profileId)
  try {
    validateProfileStateSnapshot(snapshot.db)
  } finally {
    snapshot.db.close()
  }
}
