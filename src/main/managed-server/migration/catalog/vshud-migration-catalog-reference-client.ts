import { parseVshudMigrationCatalogReferenceAbortResult } from '../../../../shared/vshud-migration/vshud-migration-catalog-state'
import type {
  VshudMigrationCatalogReference,
  VshudMigrationCatalogReferenceAbortResult
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { VSHUD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY } from '../../../../shared/remote-runtime/protocol/vshud-runtime-capabilities'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import type { RuntimeRpcResponse } from '../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  VSHUD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from './vshud-migration-request'

/** Unlike migration-unsupported, this refusal cannot prove no earlier stage exists. */
export const VSHUD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED =
  'vshud_migration_destination_abort_by_reference_unsupported:Update Vshu on this host to cancel this move.'

/** Abort by manifest identity when the full request cannot fit the sealed frame. */
export async function abortRemoteVshudMigrationCatalogByReference(
  pairingCode: string,
  manifest: VshudMigrationCatalogReference,
  options: CatalogRequestOptions = {}
): Promise<VshudMigrationCatalogReferenceAbortResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('vshud_migration_pairing_code_invalid')
  }
  let supportsReference = false
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await sendSupportedMigrationRequest(
      pairing,
      'vshud.migration.abortCatalogByReference',
      { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 },
      options,
      false,
      null,
      (capabilities) => {
        supportsReference = capabilities.includes(
          VSHUD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY
        )
        if (!supportsReference) {
          throw new Error(VSHUD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
        }
      }
    )
  } catch (error) {
    // A missing method on a host that advertised it proves nothing about what it staged.
    if (
      supportsReference &&
      error instanceof Error &&
      error.message === VSHUD_MIGRATION_DESTINATION_UNSUPPORTED
    ) {
      throw new Error(VSHUD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`vshud_migration_abort_failed:${response.error.message}`)
  }
  return parseVshudMigrationCatalogReferenceAbortResult(response.result, manifest)
}
