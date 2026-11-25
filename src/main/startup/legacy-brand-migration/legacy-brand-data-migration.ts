import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_BRANDS } from '../../../shared/branding/legacy-brand-names'
import { copyLegacyBrandEntries, type LegacyBrandCopy } from './legacy-brand-entry-copy'

export const LEGACY_BRAND_MIGRATION_MARKER = '.vshu-legacy-brand-migration.json'

// userData folders whose own entries carry the brand: profile stores, browser partitions, hook backups.
const USER_DATA_BRANDED_FOLDERS = ['Partitions', 'codex-real-home-hooks']

export type LegacyBrandMigrationInput = {
  userDataPath: string
  homeDir: string
  log?: (message: string) => void
}

function listSubdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

function migrateUserData(userDataPath: string, onError: OnCopyError): LegacyBrandCopy[] {
  const folders = [
    userDataPath,
    ...listSubdirectories(join(userDataPath, 'profiles')),
    ...USER_DATA_BRANDED_FOLDERS.map((name) => join(userDataPath, name))
  ]
  return folders.flatMap((dir) =>
    copyLegacyBrandEntries({ sourceDir: dir, targetDir: dir }, onError)
  )
}

// Codex account homes prove they are Vshu's with a branded marker; without it the account is dropped
// as untrusted. Only the markers are copied: the rest of each home belongs to Codex.
const MANAGED_HOME_MARKERS: ReadonlySet<string> = new Set([
  '.vshu-managed-home',
  '.vshu-managed-home-linked'
])

function migrateManagedHomeMarkers(userDataPath: string, onError: OnCopyError): LegacyBrandCopy[] {
  return listSubdirectories(join(userDataPath, 'codex-accounts')).flatMap((accountDir) => {
    const home = join(accountDir, 'home')
    return copyLegacyBrandEntries(
      { sourceDir: home, targetDir: home, onlyTargets: MANAGED_HOME_MARKERS },
      onError
    )
  })
}

// ~/.<legacy brand> held hook scripts, keybindings, bot homes and credentials; merge into ~/.vshu.
function migrateHomeDotFolders(homeDir: string, onError: OnCopyError): LegacyBrandCopy[] {
  const targetDir = join(homeDir, '.vshu')
  return LEGACY_BRANDS.flatMap((brand) => {
    const sourceDir = join(homeDir, `.${brand}`)
    if (!existsSync(sourceDir)) {
      return []
    }
    mkdirSync(targetDir, { recursive: true })
    return copyLegacyBrandEntries({ sourceDir, targetDir, includeUnbranded: true }, onError)
  })
}

type OnCopyError = (error: unknown, copy: LegacyBrandCopy) => void

/**
 * One-time copy of data earlier builds stored under legacy-branded names to the vshu names this
 * build reads. Copies (old data stays as a backup), never overwrites, and never throws.
 */
export function runLegacyBrandDataMigration(input: LegacyBrandMigrationInput): LegacyBrandCopy[] {
  const log = input.log ?? ((message: string) => console.log(message))
  const markerPath = join(input.userDataPath, LEGACY_BRAND_MIGRATION_MARKER)
  try {
    if (existsSync(markerPath)) {
      return []
    }
    let failures = 0
    const onError: OnCopyError = (error, copy) => {
      failures++
      log(`[legacy-brand-migration] could not copy ${copy.from} to ${copy.to}: ${String(error)}`)
    }
    const copied = [
      ...migrateUserData(input.userDataPath, onError),
      ...migrateManagedHomeMarkers(input.userDataPath, onError),
      ...migrateHomeDotFolders(input.homeDir, onError)
    ]
    for (const copy of copied) {
      log(`[legacy-brand-migration] copied ${copy.from} to ${copy.to}`)
    }
    // A failed copy is retried next launch; a clean run is never repeated.
    if (failures === 0) {
      mkdirSync(input.userDataPath, { recursive: true })
      writeFileSync(
        markerPath,
        `${JSON.stringify({ completedAt: new Date().toISOString(), copied }, null, 2)}\n`
      )
    }
    return copied
  } catch (error) {
    log(`[legacy-brand-migration] skipped: ${String(error)}`)
    return []
  }
}
