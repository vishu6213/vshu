import '../../../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { SshTarget } from '../../../../shared/remote-runtime/ssh/ssh-types'
import { closeTestStores, createSqliteTestStore } from '../../persistence-test-harness'
import { Store } from '../../loading-store/store'
import { SshConnectionStore } from '../../../ssh/targets/ssh-connection-store'
import { vshudMigrationCutoverFixture } from '../../../managed-server/migration/cutover/testing/vshud-migration-cutover-fixture'
import {
  findVshudMigrationSourceCutoverForTarget,
  writeVshudMigrationSourceCutover
} from '../cutover-journals/vshud-migration-cutover-journal'
import { keepVshudServerVersion } from '../../../managed-server/migration/cutover/vshud-migration-delta-move'
import { createVshudMigrationManifest } from '../source/catalog/vshud-migration-manifest-export'
import {
  currentVshudSourceFingerprint,
  reconcileManagedVshudSshTargets
} from './vshud-retained-source'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}
const FENCE = { environmentId: 'env-1' }
const now = () => new Date('2026-10-22T00:00:00.000Z')

let userDataPath: string
let store: Store

function repo(id: string, path: string): Repo {
  return {
    id,
    path,
    displayName: id,
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  }
}

/** Commit the initial source manifest while retaining hidden desktop rows. */
function movedHost(): void {
  const manifest = createVshudMigrationManifest(store, store.getSshTarget(TARGET.id)!, {
    migrationId: 'm-1',
    destinationEnvironmentId: FENCE.environmentId,
    now
  })
  writeVshudMigrationSourceCutover(userDataPath, {
    ...vshudMigrationCutoverFixture('m-1', TARGET.id),
    phase: 'destination-committed',
    sourceRetainedAt: now().toISOString(),
    manifestSha256: manifest.manifestSha256,
    manifest
  })
  store.updateSshTarget(TARGET.id, { vshudFence: FENCE })
}

const changedAt = () => store.getSshTarget(TARGET.id)?.vshudFence?.sourceChangedAt

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'vshud-retained-changes-'))
  store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'vshu-data.json') })
  store.addSshTarget(TARGET)
  store.addRepo(repo('repo-1', '/srv/app'))
  // A desktop group holding the host's project and a folder of it, which the move took along.
  const group = store.createProjectGroup({ name: 'work', createdFrom: 'manual' })
  store.moveProjectToGroup(store.getRepo('repo-1')!, group.id)
  store.createFolderWorkspace({
    projectGroupId: group.id,
    folderPath: '/srv/notes',
    connectionId: TARGET.id
  })
})

afterEach(async () => {
  await closeTestStores()
  rmSync(userDataPath, { recursive: true, force: true })
})

describe('what makes a moved host changed', () => {
  it('lifts a mark an earlier build set for a group edit, but not one for an added project', async () => {
    movedHost()
    store.deleteProjectGroup(store.getProjectGroups()[0]!.id)
    store.updateSshTarget(TARGET.id, { vshudFence: { ...FENCE, sourceChangedAt: 'earlier' } })
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBeUndefined()
    expect(store.getSshTarget(TARGET.id)?.vshudFence).toEqual(FENCE)

    store.addRepo(repo('repo-2', '/srv/tool'))
    store.updateSshTarget(TARGET.id, { vshudFence: { ...FENCE, sourceChangedAt: 'earlier' } })
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBe('earlier')
  })

  it('upgrades a server version an earlier build kept, so a later group edit is no change', async () => {
    movedHost()
    store.addRepo(repo('repo-2', '/srv/tool'))
    // What an earlier build's "keep the server's version" wrote: a baseline, no list of kept rows.
    const head = findVshudMigrationSourceCutoverForTarget(userDataPath, TARGET.id)!
    writeVshudMigrationSourceCutover(userDataPath, {
      ...head,
      sourceBaselineFingerprint: currentVshudSourceFingerprint(store, TARGET)
    })
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBeUndefined()

    store.deleteProjectGroup(store.getProjectGroups()[0]!.id)
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBeUndefined()
    store.addRepo(repo('repo-3', '/srv/docs'))
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBeDefined()
  })

  it('keeps the server version so a later group edit is no change, and a new project is', async () => {
    movedHost()
    store.addRepo(repo('repo-2', '/srv/tool'))
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SshConnectionStore wraps the real test store it is given.
    const claims = new SshConnectionStore(store as never).getVshudRuntimeClaims()
    await keepVshudServerVersion({
      userDataPath,
      store,
      claims,
      target: store.getSshTarget(TARGET.id)!
    })
    expect(changedAt()).toBeUndefined()

    store.deleteProjectGroup(store.getProjectGroups()[0]!.id)
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBeUndefined()
    store.addRepo(repo('repo-3', '/srv/docs'))
    await reconcileManagedVshudSshTargets(userDataPath, store, now)
    expect(changedAt()).toBeDefined()
  })
})
