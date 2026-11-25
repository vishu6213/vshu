import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { legacyBrandRank, rebrandLegacyName } from '../../../shared/branding/legacy-brand-names'

export type LegacyBrandCopy = { from: string; to: string }

export type CopyLegacyBrandEntriesOptions = {
  sourceDir: string
  targetDir: string
  /** Copy every entry (renaming branded ones), not only branded ones; for merging a legacy folder. */
  includeUnbranded?: boolean
  /** Copy only entries whose vshu name is listed; for folders the app shares with other tools. */
  onlyTargets?: ReadonlySet<string>
}

const SQLITE_SIDECAR = /-(?:wal|shm|journal)$/
// Live ownership records of a process that may still run; a copy would claim a lock nobody holds.
const NEVER_COPIED = /\.(?:lock|arbiter|pid)$/i

type Candidate = { name: string; target: string; rank: number }

function listCandidates(options: CopyLegacyBrandEntriesOptions): Candidate[] {
  let names: string[]
  try {
    names = readdirSync(options.sourceDir)
  } catch {
    return []
  }
  const byTarget = new Map<string, Candidate>()
  for (const name of names) {
    const target = rebrandLegacyName(name)
    const rank = legacyBrandRank(name)
    if ((target === name && !options.includeUnbranded) || NEVER_COPIED.test(name)) {
      continue
    }
    if (options.onlyTargets && !options.onlyTargets.has(target)) {
      continue
    }
    const current = byTarget.get(target)
    // A newer brand's copy wins; unbranded entries (rank -1) only fill gaps.
    if (!current || (rank !== -1 && (current.rank === -1 || rank < current.rank))) {
      byTarget.set(target, { name, target, rank })
    }
  }
  // Main files first, so a SQLite sidecar can follow only the database it belongs to.
  return [...byTarget.values()].sort(
    (a, b) => Number(SQLITE_SIDECAR.test(a.name)) - Number(SQLITE_SIDECAR.test(b.name))
  )
}

// Stage beside the target so a crash mid-copy never leaves a partial entry that would block a retry.
function copyEntry(from: string, to: string): void {
  const staging = `${to}.vshu-migrating-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  try {
    cpSync(from, staging, {
      recursive: true,
      force: false,
      errorOnExist: false,
      preserveTimestamps: true,
      verbatimSymlinks: true
    })
    renameSync(staging, to)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Copies legacy-branded entries of `sourceDir` to their vshu names in `targetDir`; never overwrites. */
export function copyLegacyBrandEntries(
  options: CopyLegacyBrandEntriesOptions,
  onError: (error: unknown, copy: LegacyBrandCopy) => void
): LegacyBrandCopy[] {
  const copied: LegacyBrandCopy[] = []
  const copiedTargets = new Set<string>()
  for (const candidate of listCandidates(options)) {
    const copy = {
      from: join(options.sourceDir, candidate.name),
      to: join(options.targetDir, candidate.target)
    }
    if (existsSync(copy.to)) {
      continue
    }
    // A stale WAL next to a database that already existed would corrupt it.
    const sidecarOf = candidate.target.replace(SQLITE_SIDECAR, '')
    if (sidecarOf !== candidate.target && !copiedTargets.has(sidecarOf)) {
      continue
    }
    try {
      copyEntry(copy.from, copy.to)
      copiedTargets.add(candidate.target)
      copied.push(copy)
    } catch (error) {
      onError(error, copy)
    }
  }
  return copied
}
