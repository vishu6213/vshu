import { vi, type Mock } from 'vitest'
import type {
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'
import { parseVshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest-validation'
import { advertisedVshudMigrationDestinationCapabilities } from '../../../../vshud/migration/vshud-migration-destination-capabilities'
import { assertVshudMigrationManifestDigest } from '../../../../vshud/migration/vshud-migration-manifest-digest'
import type { Store } from '../../../../persistence/loading-store/store'
import type { VshudMigrationDestinationCatalog } from '../vshud-migration-cutover-coordinator'

type Catalog = VshudMigrationDestinationCatalog

export type FakeVshudMigrationDestination = { commits: number } & {
  [Method in keyof Catalog]: Mock<Catalog[Method]>
}

/** Model idempotent stage and receipt-keyed commit with separate catalog state for each migration, including later deltas. */
export function fakeVshudMigrationDestination(): FakeVshudMigrationDestination {
  const states = new Map<string, 'absent' | 'staged' | 'committed'>()
  const stateOf = (manifest: Pick<VshudMigrationManifest, 'migrationId'>) =>
    states.get(manifest.migrationId) ?? 'absent'
  const view = (manifest: VshudMigrationManifest): VshudMigrationCatalogState => {
    const state = stateOf(manifest)
    const base = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
    if (state === 'committed') {
      return {
        ...base,
        state,
        receipt: {
          version: 1,
          migrationId: manifest.migrationId,
          manifestSha256: manifest.manifestSha256,
          source: manifest.source,
          importedAt: '2026-10-01T00:00:00.000Z',
          repositoryIds: [],
          projectGroupIds: [],
          folderWorkspaceIds: []
        }
      }
    }
    return state === 'staged'
      ? { ...base, state, stagedAt: '2026-10-01T00:00:00.000Z', snapshotUploads: [] }
      : { ...base, state }
  }
  const destination: FakeVshudMigrationDestination = {
    commits: 0,
    readState: vi.fn<Catalog['readState']>(async (manifest: VshudMigrationManifest) =>
      view(manifest)
    ),
    stage: vi.fn<Catalog['stage']>(async (manifest: VshudMigrationManifest) => {
      if (stateOf(manifest) === 'absent') {
        states.set(manifest.migrationId, 'staged')
      }
      return view(manifest)
    }),
    commit: vi.fn<Catalog['commit']>(async (manifest: VshudMigrationManifest) => {
      if (stateOf(manifest) === 'staged') {
        states.set(manifest.migrationId, 'committed')
        destination.commits += 1
      }
      return view(manifest)
    }),
    abort: vi.fn<Catalog['abort']>(async (manifest: VshudMigrationManifest) => {
      const aborted = stateOf(manifest) === 'staged'
      if (aborted) {
        states.set(manifest.migrationId, 'absent')
      }
      return { ...view(manifest), aborted, ...(aborted ? {} : { durableAbsent: true as const }) }
    }),
    abortByReference: vi.fn<Catalog['abortByReference']>(async (manifest) => {
      const identity = {
        migrationId: manifest.migrationId,
        manifestSha256: manifest.manifestSha256
      }
      if (stateOf(manifest) === 'committed') {
        return { ...identity, state: 'committed', aborted: false }
      }
      const aborted = stateOf(manifest) === 'staged'
      states.delete(manifest.migrationId)
      return { ...identity, state: 'absent', aborted, durableAbsent: true }
    }),
    stageChunk: vi.fn<Catalog['stageChunk']>(),
    readCapabilities: vi.fn<Catalog['readCapabilities']>(async () => []),
    stageBlobChunk: vi.fn<Catalog['stageBlobChunk']>()
  }
  return destination
}

/** A host server's real import, behind manifests sent as the RPC handler receives them. */
export function storeBackedVshudMigrationDestination(server: Store): Catalog {
  const sent = (manifest: VshudMigrationManifest): VshudMigrationManifest => {
    const raw = JSON.parse(JSON.stringify(manifest))
    assertVshudMigrationManifestDigest(raw)
    return parseVshudMigrationManifest(raw)
  }
  return {
    readState: async (manifest) => server.getVshudMigrationCatalogState(sent(manifest)),
    stage: async (manifest) => server.stageVshudMigrationCatalog(sent(manifest)),
    commit: async (manifest) => server.commitStagedVshudMigrationCatalog(sent(manifest)),
    abort: async (manifest) => {
      const result = server.abortStagedVshudMigrationCatalog(sent(manifest))
      return result.aborted ? result : { ...result, durableAbsent: true as const }
    },
    abortByReference: async (reference) =>
      server.abortStagedVshudMigrationCatalogByReference(reference),
    stageChunk: async (request) => server.stageVshudMigrationSnapshotChunk(request),
    readCapabilities: async () => advertisedVshudMigrationDestinationCapabilities(),
    stageBlobChunk: async (request) => server.stageVshudMigrationBlobChunk(request)
  }
}
