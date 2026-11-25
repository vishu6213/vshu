import { serializeVshudMigrationValue } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { Repo } from '../../../../shared/repository/repo-types'

export function selectNewRows<T extends { id: string }>(
  incoming: T[],
  existing: T[],
  conflictError: (id: string) => string,
  sameRow: (left: T, right: T) => boolean = (left, right) =>
    serializeVshudMigrationValue(left) === serializeVshudMigrationValue(right)
): T[] {
  const existingById = new Map(existing.map((row) => [row.id, row]))
  return incoming.filter((row) => {
    const current = existingById.get(row.id)
    if (!current) {
      return true
    }
    if (!sameRow(current, row)) {
      throw new Error(conflictError(row.id))
    }
    return false
  })
}

function isAutomaticGitHubIcon(repo: Repo): boolean {
  return repo.repoIcon?.type === 'image' && repo.repoIcon.source === 'github'
}

function withoutHostProbeCache(repo: Repo, dropIcon: boolean): Partial<Repo> {
  const { gitRemoteIdentity: _identity, repoIcon, ...configuration } = repo
  return dropIcon ? configuration : { ...configuration, repoIcon }
}

export function sameVshudRepositoryConfiguration(current: Repo, incoming: Repo): boolean {
  // Preserve this host's Git probe and the automatic avatar enriched alongside it.
  const dropIcon = isAutomaticGitHubIcon(current) && isAutomaticGitHubIcon(incoming)
  return (
    serializeVshudMigrationValue(withoutHostProbeCache(current, dropIcon)) ===
    serializeVshudMigrationValue(withoutHostProbeCache(incoming, dropIcon))
  )
}

export function assertSameValue(left: unknown, right: unknown, label: string): void {
  if (serializeVshudMigrationValue(left) !== serializeVshudMigrationValue(right)) {
    throw new Error(`vshud_migration_dormant_id_conflict:${label}`)
  }
}
