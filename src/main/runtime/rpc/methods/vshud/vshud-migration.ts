import type { z } from 'zod'
import {
  VshudMigrationCatalogParams,
  VshudMigrationCatalogReferenceParams,
  VshudMigrationCommitCatalogParams
} from '../../../../../shared/rpc-contract/host-management/vshud-migration-params'
import { parseVshudMigrationManifest } from '../../../../../shared/vshud-migration/vshud-migration-manifest-validation'
import { VshudMigrationSnapshotChunkRequestSchema } from '../../../../../shared/vshud-migration/vshud-migration-scrollback'
import { VshudMigrationBlobChunkRequestSchema } from '../../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import { assertVshudMigrationManifestDigest } from '../../../../vshud/migration/vshud-migration-manifest-digest'
import { assertVshudMigrationSourceServedHere } from '../../../../vshud/migration/vshud-migration-wsl-destination'
import { defineMethod, type RpcContext } from '../../core'

export const VSHUD_MIGRATION_METHODS = [
  defineMethod({
    name: 'vshud.migration.stageCatalog',
    permission: 'host-admin',
    params: VshudMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageVshudMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'vshud.migration.commitCatalog',
    permission: 'host-admin',
    params: VshudMigrationCommitCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.commitStagedVshudMigrationCatalog(migrationManifest(params), {
        signal: context.signal,
        ...(params.expectedBlobs ? { expectedBlobs: params.expectedBlobs } : {})
      })
    }
  }),
  defineMethod({
    name: 'vshud.migration.stageSnapshotChunk',
    permission: 'host-admin',
    params: VshudMigrationSnapshotChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageVshudMigrationSnapshotChunk(params)
    }
  }),
  // A separate method, not a field on stageSnapshotChunk: an older host would strip the field and
  // stage the bytes as a snapshot.
  defineMethod({
    name: 'vshud.migration.stageBlobChunk',
    permission: 'host-admin',
    params: VshudMigrationBlobChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageVshudMigrationBlobChunk(params)
    }
  }),
  defineMethod({
    name: 'vshud.migration.abortCatalog',
    permission: 'host-admin',
    params: VshudMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedVshudMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  // Why a reference: a source fenced on a manifest no request can carry must still be releasable.
  defineMethod({
    name: 'vshud.migration.abortCatalogByReference',
    permission: 'host-admin',
    params: VshudMigrationCatalogReferenceParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedVshudMigrationCatalogByReference(params, {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'vshud.migration.catalogState',
    permission: 'host-admin',
    params: VshudMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.getVshudMigrationCatalogState(migrationManifest(params))
    }
  })
]

function migrationManifest(params: z.infer<typeof VshudMigrationCatalogParams>) {
  const manifest = parseVshudMigrationManifest(params.manifest)
  // Raw, not parsed: parsing drops fields this host predates, which a newer client signed.
  assertVshudMigrationManifestDigest(params.manifest)
  assertVshudMigrationSourceServedHere(manifest.source)
  return manifest
}

function requireMigrationRuntimeClient(context: RpcContext): void {
  if (context.clientKind !== 'runtime' || !context.pairedDeviceId) {
    throw new Error('vshud_migration_runtime_client_required')
  }
}
