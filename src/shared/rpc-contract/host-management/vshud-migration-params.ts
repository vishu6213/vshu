import { z } from 'zod'
import {
  MAX_VSHUD_MIGRATION_BLOBS,
  VshudMigrationBlobDescriptorSchema
} from '../../vshud-migration/vshud-migration-blob-transfer'

// Let the handler parse/digest-check the manifest so malformed input receives a migration-specific refusal.
export const VshudMigrationCatalogParams = z.object({ manifest: z.unknown() })

// Optional: sent only to a blob-channel destination, so SSH and older peers see `{ manifest }`.
export const VshudMigrationCommitCatalogParams = VshudMigrationCatalogParams.extend({
  expectedBlobs: z
    .array(VshudMigrationBlobDescriptorSchema)
    .max(MAX_VSHUD_MIGRATION_BLOBS)
    .optional()
})

// The manifest's identity alone, for a request the whole manifest would overflow.
export const VshudMigrationCatalogReferenceParams = z.object({
  migrationId: z.string().min(1).max(256),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
})
