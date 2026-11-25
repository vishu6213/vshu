import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import {
  REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES,
  REMOTE_RUNTIME_REQUEST_ENVELOPE_RESERVE_BYTES
} from '../../../../shared/remote-runtime/remote-runtime-memory-limits'
import { describeOversizedVshudMigrationPayload } from './vshud-migration-payload-capacity'

/** The largest catalog-request params that still fit the host's sealed inbound frame. */
export const VSHUD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES =
  REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES - REMOTE_RUNTIME_REQUEST_ENVELOPE_RESERVE_BYTES

/** Reject oversized manifest requests before fencing: stage/state/full abort would all exceed the sealed frame and close its socket. */
export function assertVshudMigrationRequestFits(params: {
  manifest: VshudMigrationManifest
}): void {
  if (!vshudMigrationRequestFits(params)) {
    throw new Error(
      describeOversizedVshudMigrationPayload(
        params.manifest.payload,
        VSHUD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES
      )
    )
  }
}

export function vshudMigrationRequestFits(params: { manifest: VshudMigrationManifest }): boolean {
  return (
    Buffer.byteLength(JSON.stringify(params), 'utf8') <= VSHUD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES
  )
}
