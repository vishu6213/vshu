/** The move driver's connected WSL host: the distro's server, reached through its paired runtime. */
import { encodePairingOffer } from '../../../shared/remote-runtime/pairing/pairing'
import { getPreferredPairingOffer } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findWslHostDeployment } from '../../../shared/remote-runtime/host-store/runtime-environment-wsl-host-store'
import { vshudMigrationDestinationFor } from '../../managed-server/lifecycle/vshud-runtime-conversion-wiring'
import { ensureWslMoveDestinationBrowserLogins } from '../../persistence/moving-wsl-projects/desktop-state/wsl-move-browser-cookie-copy'
import { activeBrowserRoutePartitionVshuProfileId } from '../../browser/routing/partitions/browser-route-partition-binding-runtime'
import { wslHostBrowserRouteStorage } from '../../browser/routing/local-host-partitions/wsl-host-browser-route-partition'
import type { WslMoveHost } from '../../persistence/moving-wsl-projects/execution/wsl-move-driver-ports'
import { commitRemoteVshudMigrationCatalog } from '../../managed-server/migration/catalog/vshud-migration-catalog-client'
import { listRemoteVshudRepositories } from '../../managed-server/migration/linking/vshud-server-repositories'
import { stageRemoteVshudMigrationBlobChunk } from '../../managed-server/migration/transfers/vshud-migration-chunk-client'
import { listRemoteVshudFolderCatalog } from '../../managed-server/migration/linking/vshud-server-folder-workspaces'
import { getWslHostService } from '../../wsl/host-lifecycle/wsl-host-service-instance'
import { defaultWslVshudEnvironmentId } from '../../wsl/vshud/wsl-vshud-deploy'
import { getRuntimeEnvironmentStatus } from '../runtime-environments/status/runtime-environment-status-probe'
import {
  connectWslMoveHostService,
  wslMoveHostServerState,
  type WslMoveHostConnectMode
} from './wsl-move-host-connect'

export async function connectWslMoveHost(
  userDataPath: string,
  distro: string,
  mode: WslMoveHostConnectMode
): Promise<WslMoveHost | null> {
  const service = getWslHostService()
  const environmentId = defaultWslVshudEnvironmentId(distro)
  if (!service || !(await connectWslMoveHostService(service, userDataPath, distro, mode))) {
    return null
  }
  const { environment, notCarried } = await ensureWslMoveDestinationBrowserLogins({
    resolveEnvironment: async () => await resolveEnvironment(userDataPath, environmentId),
    resaveConnection: () => service.resaveConnection(environmentId),
    vshuProfileId: activeBrowserRoutePartitionVshuProfileId,
    resolveHostStorage: wslHostBrowserRouteStorage
  })
  const status = await getRuntimeEnvironmentStatus(userDataPath, environmentId)
  if (!status.ok) {
    return null
  }
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  const distroGuid =
    (await findWslHostDeployment(userDataPath, environmentId))?.distroId ?? undefined
  return {
    environmentId,
    name: environment.name,
    ...(distroGuid ? { distroGuid } : {}),
    capabilities: status.result.capabilities ?? [],
    ...wslMoveHostServerState(service, environmentId),
    ...(notCarried ? { browserLoginsNotCarried: notCarried } : {}),
    catalog: vshudMigrationDestinationFor(environment),
    commitWithBlobs: (manifest, expectedBlobs) =>
      commitRemoteVshudMigrationCatalog(pairingCode, manifest, { ...options, expectedBlobs }),
    blobs: {
      stageChunk: (request) => stageRemoteVshudMigrationBlobChunk(pairingCode, request, options)
    },
    readHolding: async () => {
      const [repositories, folders] = await Promise.all([
        listRemoteVshudRepositories(pairingCode, options),
        listRemoteVshudFolderCatalog(pairingCode, options)
      ])
      return {
        repoIds: repositories.map((repo) => repo.id),
        folderWorkspaceIds: folders.folderWorkspaces.map((folder) => folder.id),
        // The host keeps no per-distro generation it can report yet.
        highestGeneration: 0
      }
    }
  }
}
