import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Repo } from '../../../../shared/repository/repo-types'
import type { PersistedOpenFile } from '../../../../shared/workspace-session/workspace-session-state-types'
import { closeTestStores, createSqliteTestStore } from '../../persistence-test-harness'
import { Store } from '../../loading-store/store'
import {
  listVshudMigrationSourceCutovers,
  writeVshudMigrationSourceCutover
} from '../cutover-journals/vshud-migration-cutover-journal'
import { vshudMigrationCutoverFixture } from '../../../managed-server/migration/cutover/testing/vshud-migration-cutover-fixture'

import {
  retainUnretainedVshudMigrationSources,
  retainVshudMigrationSource
} from './vshud-migration-source-retention'

const TARGET_ID = 'ssh-1'
const SOURCE_HOST = `ssh:${TARGET_ID}`
const SERVER_HOST = 'runtime:env-1'
const WORKTREE = 'repo-1::/srv/app'
const REPO: Repo = {
  id: 'repo-1',
  path: '/srv/app',
  displayName: 'app',
  badgeColor: '#737373',
  addedAt: 1,
  kind: 'git',
  connectionId: TARGET_ID
}

let userDataPath: string
let store: Store

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'vshud-retention-'))
  store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'vshu-data.json') })
})

afterEach(async () => {
  await closeTestStores()
  rmSync(userDataPath, { recursive: true, force: true })
})

function committed(migrationId = 'm-1') {
  const cutover = vshudMigrationCutoverFixture(migrationId, TARGET_ID)
  return {
    ...cutover,
    phase: 'destination-committed' as const,
    manifest: {
      ...cutover.manifest,
      payload: { ...cutover.manifest.payload, repositories: [REPO] }
    }
  }
}

function draftedFile(filePath: string, draft: string): PersistedOpenFile {
  return {
    filePath,
    relativePath: filePath.slice('/srv/app/'.length),
    worktreeId: WORKTREE,
    language: 'markdown',
    dirtyDraftContent: draft,
    lastKnownDiskSignature: 'base-1'
  }
}

function saveFiles(hostId: string, files: PersistedOpenFile[]): void {
  store.setWorkspaceSession(
    { ...store.getWorkspaceSession(hostId), openFilesByWorktree: { [WORKTREE]: files } },
    hostId
  )
}

async function restart(): Promise<void> {
  await store.flushPendingOrThrowAsync()
  await closeTestStores()
  store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'vshu-data.json') })
}

const serverFiles = () => store.getWorkspaceSession(SERVER_HOST).openFilesByWorktree?.[WORKTREE]

describe('renaming unsaved drafts to the server on commit', () => {
  beforeEach(() => {
    store.addSshTarget({
      id: TARGET_ID,
      label: 'Prod',
      host: 'h',
      port: 22,
      username: 'u',
      generation: 2
    })
    store.addRepo(REPO)
  })

  it('keeps what the server partition already holds, and never revives a discarded draft', async () => {
    saveFiles(SOURCE_HOST, [
      draftedFile('/srv/app/a.md', 'source A'),
      draftedFile('/srv/app/b.md', 'source B')
    ])
    saveFiles(SERVER_HOST, [{ ...draftedFile('/srv/app/a.md', 'newer A') }])
    writeVshudMigrationSourceCutover(userDataPath, committed())

    await retainVshudMigrationSource(userDataPath, 'm-1', store)
    expect(serverFiles()?.map((file) => file.dirtyDraftContent)).toEqual(['newer A', 'source B'])

    saveFiles(SERVER_HOST, [])
    await retainVshudMigrationSource(userDataPath, 'm-1', store)
    expect(serverFiles()).toEqual([])
    await restart()
    await retainUnretainedVshudMigrationSources(userDataPath, store)
    await retainVshudMigrationSource(userDataPath, 'm-1', store)
    expect(serverFiles()).toEqual([])
  })

  it('renames and retains at startup after a cut-off commit, so a draft closed later stays closed', async () => {
    saveFiles(SOURCE_HOST, [draftedFile('/srv/app/a.md', 'source A')])
    writeVshudMigrationSourceCutover(userDataPath, committed())
    await restart()

    await retainUnretainedVshudMigrationSources(userDataPath, store)
    expect(serverFiles()?.map((file) => file.dirtyDraftContent)).toEqual(['source A'])
    expect(listVshudMigrationSourceCutovers(userDataPath)[0]?.sourceRetainedAt).toBeDefined()
    // Later retain/start must not resurrect a draft closed before connect.
    saveFiles(SERVER_HOST, [])
    await retainVshudMigrationSource(userDataPath, 'm-1', store)
    await retainUnretainedVshudMigrationSources(userDataPath, store)
    await restart()
    await retainUnretainedVshudMigrationSources(userDataPath, store)
    expect(serverFiles()).toEqual([])
  })

  it('makes the startup rename durable before its retained mark', async () => {
    saveFiles(SOURCE_HOST, [draftedFile('/srv/app/a.md', 'source A')])
    writeVshudMigrationSourceCutover(userDataPath, committed())
    await restart()
    await retainUnretainedVshudMigrationSources(userDataPath, store)
    expect(listVshudMigrationSourceCutovers(userDataPath)[0]?.sourceRetainedAt).toBeDefined()
    // Reopen from disk to model a crash before pending writes land.
    const crashed = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'vshu-data.json') })
    expect(
      crashed.getWorkspaceSession(SERVER_HOST).openFilesByWorktree?.[WORKTREE]?.[0]
        ?.dirtyDraftContent
    ).toBe('source A')
  })
})
