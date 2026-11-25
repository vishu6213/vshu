/** Persist journals in owner-only profile sidecars: older profile schemas drop unknown fields but retain fences, so an in-profile journal could vanish on downgrade. Unreadable journals fail closed. */
import {
  MAX_VSHUD_MIGRATION_SOURCE_CUTOVERS,
  isRetainedVshudMigrationSourceCutover,
  parseVshudMigrationSourceCutover,
  type VshudMigrationSourceCutover
} from '../../../../shared/vshud-migration/vshud-migration-source-cutover'
import {
  createMigrationJournalDirectory,
  orderMigrationJournalChain
} from './migration-journal-directory'

class VshudMigrationCutoverJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The migration journal cannot be read, so the SSH host stays fenced: ${detail}`)
    this.name = 'VshudMigrationCutoverJournalUnreadableError'
  }
}

type JournalChangeListener = (userDataPath: string) => void
let journalChangeListener: JournalChangeListener | null = null

export function setVshudMigrationJournalChangeListener(
  listener: JournalChangeListener | null
): void {
  journalChangeListener = listener
}

const journals = createMigrationJournalDirectory({
  directoryName: 'vshud-migration-cutovers',
  // A manifest carries catalog rows and dormant session state, never scrollback bytes.
  maxFileBytes: 16 * 1024 * 1024,
  parse: parseVshudMigrationSourceCutover,
  unreadable: (detail) => new VshudMigrationCutoverJournalUnreadableError(detail),
  onChange: (userDataPath) => journalChangeListener?.(userDataPath)
})

export function vshudMigrationCutoverJournalDirectory(userDataPath: string): string {
  return journals.directory(userDataPath)
}

/** Never skip an unreadable or untrusted journal. */
export function listVshudMigrationSourceCutovers(
  userDataPath: string
): VshudMigrationSourceCutover[] {
  return journals.list(userDataPath)
}

export function findVshudMigrationSourceCutoverForTarget(
  userDataPath: string,
  sshTargetId: string
): VshudMigrationSourceCutover | null {
  const chain = listVshudMigrationCutoverChainForTarget(userDataPath, sshTargetId)
  return chain.at(-1) ?? null
}

/** Oldest first; throws unless the target's journals form one chain of delta moves. */
export function listVshudMigrationCutoverChainForTarget(
  userDataPath: string,
  sshTargetId: string
): VshudMigrationSourceCutover[] {
  const matches = listVshudMigrationSourceCutovers(userDataPath).filter(
    (cutover) => cutover.sshTargetId === sshTargetId
  )
  return orderMigrationJournalChain(
    matches,
    (detail) => new VshudMigrationCutoverJournalUnreadableError(detail),
    `SSH target ${sshTargetId}`
  )
}

/** Flush before returning so later fence writes always have a durable journal. */
export function writeVshudMigrationSourceCutover(
  userDataPath: string,
  cutover: VshudMigrationSourceCutover
): void {
  const parsed = parseVshudMigrationSourceCutover(cutover)
  const existing = listVshudMigrationSourceCutovers(userDataPath)
  // Finished retained cutovers can wait two releases; only in-flight journals count toward the bound.
  const inFlight = existing.filter(
    (entry) => entry.phase !== 'source-retired' && !isRetainedVshudMigrationSourceCutover(entry)
  )
  if (
    !existing.some((entry) => entry.migrationId === parsed.migrationId) &&
    inFlight.length >= MAX_VSHUD_MIGRATION_SOURCE_CUTOVERS
  ) {
    throw new Error('vshud_migration_cutover_capacity_exceeded')
  }
  journals.write(userDataPath, parsed)
}

export function removeVshudMigrationSourceCutover(userDataPath: string, migrationId: string): void {
  journals.remove(userDataPath, migrationId)
}

export function removeVshudMigrationJournalsForDestination(
  userDataPath: string,
  sshTargetId: string,
  environmentId: string
): void {
  for (const cutover of listVshudMigrationSourceCutovers(userDataPath)) {
    if (cutover.sshTargetId === sshTargetId && cutover.destinationEnvironmentId === environmentId) {
      removeVshudMigrationSourceCutover(userDataPath, cutover.migrationId)
    }
  }
}
