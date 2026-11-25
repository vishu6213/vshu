import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getManagedVshudFenceEnvironmentId } from '../../../../shared/remote-runtime/ssh/managed-vshud-ssh-owner'
import type { SshTarget } from '../../../../shared/remote-runtime/ssh/ssh-types'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  closeTestStores,
  createSqliteTestStore
} from '../../../persistence/persistence-test-harness'
import { Store } from '../../../persistence/loading-store/store'
import {
  abortVshudMigrationCutover,
  commitVshudMigrationDestination,
  stageVshudMigrationDestination,
  type VshudMigrationCutoverContext
} from './vshud-migration-cutover-coordinator'
import { VSHUD_MIGRATION_DESTINATION_UNSUPPORTED } from '../catalog/vshud-migration-request'
import {
  listVshudMigrationSourceCutovers,
  writeVshudMigrationSourceCutover
} from '../../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import { assertVshudMigrationRequestFits } from '../catalog/vshud-migration-request-budget'
import { createVshudMigrationManifest } from '../../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import { MAX_VSHUD_MIGRATION_MANIFEST_BYTES } from '../../../../shared/vshud-migration/vshud-migration-manifest-validation'
import { fenceVshudMigrationSource } from '../../../ssh/migration-source/vshud-migration-source-fence'
import { SshTargetVshudClaims } from '../../../ssh/targets/ssh-target-vshud-claims'
import { fakeVshudMigrationDestination as fakeDestination } from './testing/vshud-migration-destination-fake'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function setup() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'vshud-cutover-coordinator-'))
  directories.push(userDataPath)
  const store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'vshu-data.json') })
  store.addSshTarget(TARGET)
  store.addRepo({
    id: 'repo-1',
    path: '/srv/app',
    displayName: 'App',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  })
  const claims = new SshTargetVshudClaims(store)
  const fenced = await fenceVshudMigrationSource({
    userDataPath,
    store,
    claims,
    targetId: TARGET.id,
    destinationEnvironmentId: 'env-1',
    destinationName: 'Managed',
    terminalProof: { verdict: 'exited', provenPtyIds: [] }
  })
  if (fenced.outcome !== 'fenced') {
    throw new Error('expected a fence')
  }
  const destination = fakeDestination()
  const context: VshudMigrationCutoverContext = { userDataPath, store, claims, destination }
  const journal = () => listVshudMigrationSourceCutovers(userDataPath)[0]
  const owner = () => getManagedVshudFenceEnvironmentId(store.getSshTarget(TARGET.id))
  return { context, destination, store, migrationId: fenced.cutover.migrationId, journal, owner }
}

describe('migration cutover coordinator', () => {
  it('never journals a commit the server holds only in memory, until its flush succeeds', async () => {
    const h = await setup()
    await stageVshudMigrationDestination(h.context, h.migrationId)
    const commit = h.destination.commit.getMockImplementation()!
    let diskFull = true
    // Committed reads can reflect memory while the durable flush still fails.
    h.destination.commit.mockImplementation(async (manifest) => {
      const state = await commit(manifest)
      if (diskFull) {
        throw new Error('disk full')
      }
      return state
    })
    await expect(commitVshudMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'disk full'
    )
    await expect(commitVshudMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'disk full'
    )
    await expect(abortVshudMigrationCutover(h.context, h.migrationId)).rejects.toThrow('disk full')
    expect(h.journal()?.phase).toBe('destination-staged')
    expect(h.owner()).toBe('env-1')

    diskFull = false
    await expect(commitVshudMigrationDestination(h.context, h.migrationId)).resolves.toMatchObject({
      phase: 'destination-committed'
    })
  })

  it('keeps the journal at staged when the commit reply and the re-read are both lost', async () => {
    const h = await setup()
    await stageVshudMigrationDestination(h.context, h.migrationId)
    h.destination.commit.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.readState.mockRejectedValueOnce(new Error('socket closed'))
    await expect(commitVshudMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'socket closed'
    )
    expect(h.journal()?.phase).toBe('destination-staged')
    expect(h.owner()).toBe('env-1')
  })

  it('refuses a commit whose source changed after staging', async () => {
    const h = await setup()
    await stageVshudMigrationDestination(h.context, h.migrationId)
    h.store.updateRepo(h.store.getRepo('repo-1')!, { displayName: 'Renamed' })
    await expect(commitVshudMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'vshud_migration_source_changed'
    )
    expect(h.destination.commit).not.toHaveBeenCalled()
  })

  it('keeps the fence after an abort loses its reply until the destination proves absence', async () => {
    const h = await setup()
    await stageVshudMigrationDestination(h.context, h.migrationId)
    const abortError = new Error('abort reply lost')
    h.destination.abort.mockRejectedValueOnce(abortError)
    h.destination.readState.mockResolvedValueOnce({
      state: 'absent',
      migrationId: h.migrationId,
      manifestSha256: h.journal()!.manifestSha256
    })
    h.destination.readState.mockRejectedValueOnce(new Error('status reply lost'))
    await expect(abortVshudMigrationCutover(h.context, h.migrationId)).rejects.toBe(abortError)
    expect(h.owner()).toBe('env-1')
    expect(h.journal()?.phase).toBe('destination-staged')

    await expect(abortVshudMigrationCutover(h.context, h.migrationId)).resolves.toEqual({
      outcome: 'released',
      evidence: 'catalog-absent'
    })
    expect(h.owner()).toBeNull()
    expect(h.journal()).toBeUndefined()
  })

  it('never releases a committed destination, even when the journal lags behind it', async () => {
    const h = await setup()
    await stageVshudMigrationDestination(h.context, h.migrationId)
    await h.destination.commit(h.journal()!.manifest)
    await expect(abortVshudMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
      outcome: 'refused',
      code: 'vshud_migration_committed_source_cannot_be_released'
    })
    expect(h.journal()?.phase).toBe('destination-committed')
    expect(h.owner()).toBe('env-1')
    await expect(abortVshudMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
      outcome: 'refused'
    })
  })

  it('releases on an unsupported destination only before anything was staged', async () => {
    const unsupported = new Error(VSHUD_MIGRATION_DESTINATION_UNSUPPORTED)
    const fresh = await setup()
    fresh.destination.readState.mockRejectedValueOnce(unsupported)
    await expect(abortVshudMigrationCutover(fresh.context, fresh.migrationId)).resolves.toEqual({
      outcome: 'released',
      evidence: 'destination-unsupported'
    })
    expect(fresh.owner()).toBeNull()

    const staged = await setup()
    await stageVshudMigrationDestination(staged.context, staged.migrationId)
    staged.destination.readState.mockRejectedValueOnce(unsupported)
    await expect(abortVshudMigrationCutover(staged.context, staged.migrationId)).rejects.toThrow(
      VSHUD_MIGRATION_DESTINATION_UNSUPPORTED
    )
    expect(staged.owner()).toBe('env-1')
  })

  it('refuses a destination answer for another manifest', async () => {
    const h = await setup()
    h.destination.stage.mockResolvedValueOnce({
      state: 'staged',
      migrationId: h.migrationId,
      manifestSha256: 'f'.repeat(64),
      stagedAt: '2026-10-01T00:00:00.000Z'
    })
    await expect(stageVshudMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'vshud_migration_destination_state_mismatch'
    )
    expect(h.journal()?.phase).toBe('source-fenced')
  })

  describe('a journal fenced before #30836 on a manifest no request can carry', () => {
    async function stuck(stagedByOlderBuild = false) {
      const h = await setup()
      const cutover = h.journal()!
      const target = {
        ...h.store.getSshTarget(TARGET.id)!,
        generation: cutover.sshTargetGeneration
      }
      const exportFor = () =>
        createVshudMigrationManifest(h.store, target, {
          migrationId: cutover.migrationId,
          destinationEnvironmentId: cutover.destinationEnvironmentId
        })
      const baseline = JSON.stringify(exportFor()).length
      // Under the export cap, over the sealed-frame request budget.
      h.store.updateRepo(h.store.getRepo('repo-1')!, {
        displayName: 'x'.repeat(MAX_VSHUD_MIGRATION_MANIFEST_BYTES - 200 - baseline)
      })
      const manifest = exportFor()
      expect(() => assertVshudMigrationRequestFits({ manifest })).toThrow(
        /vshud_migration_manifest_too_large/
      )
      writeVshudMigrationSourceCutover(h.context.userDataPath, {
        ...cutover,
        manifestSha256: manifest.manifestSha256,
        manifest
      })
      if (stagedByOlderBuild) {
        // A build before the client-side size check sent it whole, and the frame fit.
        await h.destination.stage(manifest)
      }
      // Model client refusal before sending oversized manifest requests.
      const refuseUnsent =
        <T>(real: (sent: VshudMigrationManifest) => Promise<T>) =>
        async (sent: VshudMigrationManifest): Promise<T> => {
          assertVshudMigrationRequestFits({ manifest: sent })
          return real(sent)
        }
      const d = h.destination
      d.readState.mockImplementation(refuseUnsent(d.readState.getMockImplementation()!))
      d.stage.mockImplementation(refuseUnsent(d.stage.getMockImplementation()!))
      d.commit.mockImplementation(refuseUnsent(d.commit.getMockImplementation()!))
      d.abort.mockImplementation(refuseUnsent(d.abort.getMockImplementation()!))
      return { ...h, manifest }
    }

    it('releases the fence once the server, asked by reference, proves it holds nothing', async () => {
      const h = await stuck()
      await expect(abortVshudMigrationCutover(h.context, h.migrationId)).resolves.toEqual({
        outcome: 'released',
        evidence: 'catalog-absent'
      })
      expect(h.destination.abortByReference).toHaveBeenCalledWith(h.manifest)
      expect(h.owner()).toBeNull()
      expect(h.journal()).toBeUndefined()
    })

    it('aborts, by reference, a stage an older build delivered whole', async () => {
      const h = await stuck(true)
      await expect(abortVshudMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
        outcome: 'released'
      })
      await expect(h.destination.abortByReference.mock.results[0]?.value).resolves.toMatchObject({
        state: 'absent',
        aborted: true
      })
      expect(h.owner()).toBeNull()
    })

    it('keeps the fence when the server cannot answer by reference', async () => {
      const h = await stuck()
      h.destination.abortByReference.mockRejectedValueOnce(new Error('update required'))
      await expect(abortVshudMigrationCutover(h.context, h.migrationId)).rejects.toThrow(
        'update required'
      )
      expect(h.owner()).toBe('env-1')
      expect(h.journal()?.migrationId).toBe(h.migrationId)
    })

    it('never releases a server that already committed it', async () => {
      const h = await stuck()
      h.destination.abortByReference.mockResolvedValueOnce({
        migrationId: h.migrationId,
        manifestSha256: h.manifest.manifestSha256,
        state: 'committed',
        aborted: false
      })
      await expect(abortVshudMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
        outcome: 'refused',
        code: 'vshud_migration_committed_source_cannot_be_released'
      })
      expect(h.owner()).toBe('env-1')
    })
  })
})
