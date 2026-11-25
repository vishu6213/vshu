import { encodePairingOffer } from '../../../shared/remote-runtime/pairing/pairing'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { disconnectRegisteredSshTarget } from '../../ipc/ssh/ssh-session-teardown'
import type { VshudMigrationDestinationCatalog } from '../migration/cutover/vshud-migration-cutover-coordinator'
import {
  abortRemoteVshudMigrationCatalog,
  commitRemoteVshudMigrationCatalog,
  readRemoteVshudMigrationCatalogState,
  stageRemoteVshudMigrationCatalog
} from '../migration/catalog/vshud-migration-catalog-client'
import {
  listRemoteVshudRepositories,
  type VshudServerRepository
} from '../migration/linking/vshud-server-repositories'
import {
  stageRemoteVshudMigrationBlobChunk,
  stageRemoteVshudMigrationSnapshotChunk
} from '../migration/transfers/vshud-migration-chunk-client'
import { readRemoteVshudMigrationCapabilities } from '../migration/catalog/vshud-migration-capabilities-client'
import { abortRemoteVshudMigrationCatalogByReference } from '../migration/catalog/vshud-migration-catalog-reference-client'
import {
  enableRemoteVshudAutomation,
  type EnableServerAutomation
} from '../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-moved-automations'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/endpoints/ssh-host-relay-census-for-target'
import { isBridgeableLease } from '../../ssh/legacy-relay/bridge/legacy-relay-bridge-leases'
import type { VshudManagedConversionArgs } from './vshud-runtime-conversion'

import {
  listRemoteVshudFolderCatalog,
  type VshudServerFolderCatalog
} from '../migration/linking/vshud-server-folder-workspaces'

export function vshudMigrationDestinationFor(
  environment: KnownRuntimeEnvironment
): VshudMigrationDestinationCatalog {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return {
    readState: (manifest) => readRemoteVshudMigrationCatalogState(pairingCode, manifest, options),
    stage: (manifest) => stageRemoteVshudMigrationCatalog(pairingCode, manifest, options),
    commit: (manifest) => commitRemoteVshudMigrationCatalog(pairingCode, manifest, options),
    abort: (manifest) => abortRemoteVshudMigrationCatalog(pairingCode, manifest, options),
    abortByReference: (manifest) =>
      abortRemoteVshudMigrationCatalogByReference(pairingCode, manifest, options),
    stageChunk: (request) => stageRemoteVshudMigrationSnapshotChunk(pairingCode, request, options),
    readCapabilities: () => readRemoteVshudMigrationCapabilities(pairingCode, options),
    stageBlobChunk: (request) => stageRemoteVshudMigrationBlobChunk(pairingCode, request, options)
  }
}

export function vshudServerRepositoriesFor(
  environment: KnownRuntimeEnvironment
): Promise<VshudServerRepository[]> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteVshudRepositories(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function vshudServerFolderCatalogFor(
  environment: KnownRuntimeEnvironment
): Promise<VshudServerFolderCatalog> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteVshudFolderCatalog(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function vshudServerAutomationEnablerFor(
  environment: KnownRuntimeEnvironment
): EnableServerAutomation {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return (automation) => enableRemoteVshudAutomation(pairingCode, automation, options)
}

export function conversionCollaborators(): Pick<
  VshudManagedConversionArgs,
  | 'destinationFor'
  | 'serverRepositoriesFor'
  | 'serverFolderCatalogFor'
  | 'serverAutomationEnablerFor'
  | 'censusHost'
  | 'isBridgedPaneLease'
  | 'releaseDirectSession'
> {
  return {
    destinationFor: vshudMigrationDestinationFor,
    serverRepositoriesFor: vshudServerRepositoriesFor,
    serverFolderCatalogFor: vshudServerFolderCatalogFor,
    serverAutomationEnablerFor: vshudServerAutomationEnablerFor,
    censusHost: (target) => censusHostRelayTerminalsFor(target)(),
    isBridgedPaneLease: isBridgeableLease,
    releaseDirectSession: disconnectRegisteredSshTarget
  }
}
