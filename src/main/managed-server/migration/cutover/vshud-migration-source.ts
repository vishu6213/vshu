/** Expose fenced-source checks/release through the cutover port; conversion owns terminal assessment, export and fence acquisition. */
import type { VshudMigrationSourceKind } from '../../../../shared/vshud-migration/vshud-migration-source-kind'
import type {
  VshudMigrationCatalogPayload,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import type { VshudMigrationSourceCutover } from '../../../../shared/vshud-migration/vshud-migration-source-cutover'
import type {
  VshudMigrationExportedBlob,
  VshudMigrationManifestExportOptions
} from '../../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import type {
  VshudMigrationFenceResult,
  VshudMigrationFenceState
} from '../../../ssh/migration-source/vshud-migration-source-fence'
import type { VshudMigrationTerminalVerdict } from '../../../ssh/migration-source/vshud-migration-terminal-gate'

export type VshudMigrationSourceCutoverPort = {
  /** Before every stage and commit; throws unless the fenced source still matches the journal.
   * Returns the bytes of the blobs its manifest names, which that match proves are the journaled ones. */
  verifyFence: (cutover: VshudMigrationSourceCutover) => VshudMigrationExportedBlob[]
  /** Drops the fence, then the journal; only on proof the destination holds nothing. */
  releaseFence: (cutover: VshudMigrationSourceCutover) => Promise<void>
}

type VshudMigrationFenceAcquireArgs = {
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: VshudMigrationTerminalVerdict
  now?: () => Date
  signal?: AbortSignal
}

export type VshudMigrationSource = VshudMigrationSourceCutoverPort & {
  readonly kind: VshudMigrationSourceKind
  readonly journalKey: string
  collectCatalog: () => VshudMigrationCatalogPayload
  /** Rewrite paths before signing; export must not mutate source. */
  exportManifest: (options?: VshudMigrationManifestExportOptions) => VshudMigrationManifest
  /** Before the fence. Loss of contact is `unverifiable`, never `exited`. */
  assessTerminals: () => Promise<VshudMigrationTerminalVerdict>
  retireProvenExitedTerminals: (proof: VshudMigrationTerminalVerdict) => void
  /** Throws when the journal cannot be read: an unreadable record keeps the source fenced. */
  resolveFence: () => VshudMigrationFenceState
  /** Journal, then fence, then flush, then the terminal re-check under the fence. */
  acquireFence: (args: VshudMigrationFenceAcquireArgs) => Promise<VshudMigrationFenceResult>
}
