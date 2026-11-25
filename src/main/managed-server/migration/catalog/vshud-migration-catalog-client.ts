import { hasModernAutomationLaunchSetup } from '../../../../shared/automations/launch/automation-launch-setup'
import { automationCanonicalLaunchSetup } from '../../../../shared/automations/launch/automation-canonical-launch-setup'
import { AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY } from '../../../../shared/automations/automation-runtime-capabilities'
import {
  parseVshudMigrationCatalogAbortResult,
  parseVshudMigrationCatalogState
} from '../../../../shared/vshud-migration/vshud-migration-catalog-state'

import type {
  VshudMigrationCatalogAbortResult,
  VshudMigrationCatalogState,
  VshudMigrationManifest
} from '../../../../shared/vshud-migration/vshud-migration-manifest'

import {
  findUnsupportedMigrationBlobKind,
  vshudMigrationBlobKindUnsupportedBlocker
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'

import type { VshudMigrationBlobDescriptor } from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import { vshudMigrationManifestBlobs } from '../../../../shared/vshud-migration/vshud-migration-automation-run-history'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import { assertVshudMigrationRequestFits } from './vshud-migration-request-budget'
import { hasExtraAgentArgs } from '../../../../shared/agent-launch/startup/automation-extra-agent-args'
import { requiredVshudMigrationSourceCapability } from '../../../../shared/vshud-migration/vshud-migration-source-kind'
import type { CatalogRequestOptions } from './vshud-migration-request'
import { sendSupportedMigrationRequest } from './vshud-migration-request'

type VshudCatalogMigrationOperation = 'abort' | 'commit' | 'stage' | 'state'

const METHOD_BY_OPERATION: Record<VshudCatalogMigrationOperation, string> = {
  abort: 'vshud.migration.abortCatalog',
  commit: 'vshud.migration.commitCatalog',
  stage: 'vshud.migration.stageCatalog',
  state: 'vshud.migration.catalogState'
}

export function stageRemoteVshudMigrationCatalog(
  pairingCode: string,
  manifest: VshudMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<VshudMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'stage', manifest, options)
}

/** Expected blobs make the destination refuse incomplete commits. */
export async function commitRemoteVshudMigrationCatalog(
  pairingCode: string,
  manifest: VshudMigrationManifest,
  options: CatalogRequestOptions & {
    expectedBlobs?: readonly VshudMigrationBlobDescriptor[]
  } = {}
): Promise<VshudMigrationCatalogState> {
  const result = await request(pairingCode, 'commit', manifest, options, options.expectedBlobs)
  return parseVshudMigrationCatalogState(result, manifest)
}

export function readRemoteVshudMigrationCatalogState(
  pairingCode: string,
  manifest: VshudMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<VshudMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'state', manifest, options)
}

export async function abortRemoteVshudMigrationCatalog(
  pairingCode: string,
  manifest: VshudMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<VshudMigrationCatalogAbortResult> {
  const result = await request(pairingCode, 'abort', manifest, options)
  const parsed = parseVshudMigrationCatalogAbortResult(result, manifest)
  // Older already-absent replies prove no durability, unlike real aborts.
  if (parsed.state === 'absent' && !parsed.aborted && parsed.durableAbsent !== true) {
    throw new Error('vshud_migration_abort_durability_unverifiable:destination_update_required')
  }
  return parsed
}

async function requestCatalogState(
  pairingCode: string,
  operation: Exclude<VshudCatalogMigrationOperation, 'abort'>,
  manifest: VshudMigrationManifest,
  options: CatalogRequestOptions
): Promise<VshudMigrationCatalogState> {
  const result = await request(pairingCode, operation, manifest, options)
  return parseVshudMigrationCatalogState(result, manifest)
}

async function request(
  pairingCode: string,
  operation: VshudCatalogMigrationOperation,
  manifest: VshudMigrationManifest,
  options: CatalogRequestOptions,
  expectedBlobs: readonly VshudMigrationBlobDescriptor[] = []
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('vshud_migration_pairing_code_invalid')
  }
  // Preserve exact { manifest } wire shape for blob-free and SSH moves.
  const params = expectedBlobs.length > 0 ? { manifest, expectedBlobs } : { manifest }
  // Validation-size limits can exceed sealed-frame capacity; reject before the host closes the socket.
  assertVshudMigrationRequestFits(params)
  const imports = operation === 'stage' || operation === 'commit'
  const carriesExtraAgentArgs =
    imports &&
    (manifest.payload.dormantState?.automations ?? []).some((automation) =>
      hasExtraAgentArgs(automation.extraAgentArgs)
    )
  // An older host would drop the blob a manifest names and import without its rows.
  const requiredBlobs = imports
    ? [...expectedBlobs, ...vshudMigrationManifestBlobs(manifest)]
    : expectedBlobs
  const response = await sendSupportedMigrationRequest(
    pairing,
    METHOD_BY_OPERATION[operation],
    params,
    options,
    carriesExtraAgentArgs,
    // Recheck source capabilities on every operation; older hosts may misparse non-SSH sources.
    requiredVshudMigrationSourceCapability(manifest.source),
    // Hosts without blob capability would strip expectedBlobs and commit unchecked.
    (capabilities) => {
      if (
        imports &&
        (manifest.payload.dormantState?.automations ?? []).some((automation) =>
          hasModernAutomationLaunchSetup(automationCanonicalLaunchSetup(automation))
        ) &&
        !capabilities.includes(AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY)
      ) {
        throw new Error(
          'Update Vshu on the destination host to keep automation agent launch settings.'
        )
      }
      const unsupported = findUnsupportedMigrationBlobKind(requiredBlobs, capabilities)
      if (unsupported) {
        throw new Error(vshudMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`vshud_migration_${operation}_failed:${response.error.message}`)
  }
  return response.result
}
