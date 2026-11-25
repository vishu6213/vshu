import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runLegacyBrandDataMigration } from './legacy-brand-data-migration'

// Split so the rebrand codemod leaves these pre-rebrand names alone.
const ORIGINAL = 'or' + 'ca'
const NEWER = 'hel' + 'ix'

let root: string
let userData: string
let home: string

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function migrate(): void {
  runLegacyBrandDataMigration({ userDataPath: userData, homeDir: home, log: () => {} })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legacy-brand-migration-'))
  userData = join(root, 'userData')
  home = join(root, 'home')
  mkdirSync(userData, { recursive: true })
  mkdirSync(home, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('runLegacyBrandDataMigration', () => {
  it('copies branded userData files to vshu names, keeping the originals', () => {
    write(join(userData, `${ORIGINAL}-profile-index.json`), 'index')
    write(join(userData, `${ORIGINAL}-e2ee-keypair.json`), 'keys')

    migrate()

    expect(read(join(userData, 'vshu-profile-index.json'))).toBe('index')
    expect(read(join(userData, 'vshu-e2ee-keypair.json'))).toBe('keys')
    expect(read(join(userData, `${ORIGINAL}-profile-index.json`))).toBe('index')
  })

  it('never overwrites existing vshu data and prefers the newer brand', () => {
    write(join(userData, `${ORIGINAL}-stats.json`), 'old stats')
    write(join(userData, 'vshu-stats.json'), 'current stats')
    write(join(userData, `${ORIGINAL}-runtime.json`), 'oldest')
    write(join(userData, `${NEWER}-runtime.json`), 'newer')

    migrate()

    expect(read(join(userData, 'vshu-stats.json'))).toBe('current stats')
    expect(read(join(userData, 'vshu-runtime.json'))).toBe('newer')
  })

  it('skips lock files', () => {
    write(join(userData, `${ORIGINAL}d.lock`), 'pid')

    migrate()

    expect(existsSync(join(userData, 'vshud.lock'))).toBe(false)
  })

  it('copies profile stores and browser partitions recursively', () => {
    const profile = join(userData, 'profiles', 'local-default')
    write(join(profile, `${ORIGINAL}-secret-protection.json`), 'protected')
    write(join(userData, 'Partitions', `${ORIGINAL}-browser`, 'Cookies'), 'cookies')

    migrate()

    expect(read(join(profile, 'vshu-secret-protection.json'))).toBe('protected')
    expect(read(join(userData, 'Partitions', 'vshu-browser', 'Cookies'))).toBe('cookies')
  })

  it('copies Codex account home ownership markers and nothing else of the home', () => {
    const accountHome = join(userData, 'codex-accounts', 'acct-1', 'home')
    write(join(accountHome, `.${ORIGINAL}-managed-home`), 'acct-1')
    write(join(accountHome, `${ORIGINAL}-notes.md`), 'codex-owned')
    const linkedHome = join(userData, 'codex-accounts', 'acct-2', 'home')
    write(join(linkedHome, `.${NEWER}-managed-home-linked`), 'acct-2')

    migrate()

    expect(read(join(accountHome, '.vshu-managed-home'))).toBe('acct-1')
    expect(existsSync(join(accountHome, 'vshu-notes.md'))).toBe(false)
    expect(read(join(linkedHome, '.vshu-managed-home-linked'))).toBe('acct-2')
    expect(existsSync(join(linkedHome, '.vshu-managed-home'))).toBe(false)
  })

  it('copies a SQLite sidecar only together with its database', () => {
    const profile = join(userData, 'profiles', 'p1')
    write(join(profile, `${ORIGINAL}-github-cache.db`), 'db')
    write(join(profile, `${ORIGINAL}-github-cache.db-wal`), 'wal')
    write(join(userData, `${ORIGINAL}-catalog.db-wal`), 'stale wal')
    write(join(userData, 'vshu-catalog.db'), 'current db')
    write(join(userData, `${ORIGINAL}-catalog.db`), 'old db')

    migrate()

    expect(read(join(profile, 'vshu-github-cache.db-wal'))).toBe('wal')
    expect(read(join(userData, 'vshu-catalog.db'))).toBe('current db')
    expect(existsSync(join(userData, 'vshu-catalog.db-wal'))).toBe(false)
  })

  it('merges legacy home folders into ~/.vshu, newer brand first, keeping existing entries', () => {
    write(join(home, `.${ORIGINAL}`, 'keybindings.json'), 'old keys')
    write(join(home, `.${ORIGINAL}`, 'bots', 'bot.json'), 'bot')
    write(join(home, `.${NEWER}`, 'keybindings.json'), 'newer keys')
    write(join(home, '.vshu', 'claude-theme-sync.json'), 'current theme')
    write(join(home, `.${ORIGINAL}`, 'claude-theme-sync.json'), 'old theme')

    migrate()

    expect(read(join(home, '.vshu', 'keybindings.json'))).toBe('newer keys')
    expect(read(join(home, '.vshu', 'bots', 'bot.json'))).toBe('bot')
    expect(read(join(home, '.vshu', 'claude-theme-sync.json'))).toBe('current theme')
  })

  it('runs only once', () => {
    migrate()
    write(join(userData, `${ORIGINAL}-stats.json`), 'late')

    migrate()

    expect(existsSync(join(userData, 'vshu-stats.json'))).toBe(false)
  })
})
