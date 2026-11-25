/** Use the managed SSH repair gate for refused WSL enrollment: serialize, cap attempts and require the pinned host key. Read new offers inside the local distro. */
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  findWslHostDeployment,
  refreshWslHostPairing
} from '../../../shared/remote-runtime/host-store/runtime-environment-wsl-host-store'
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { readActiveManagedVshudReadiness } from '../../managed-server/lifecycle/vshud-managed-bound-port'
import {
  ManagedVshudPairingRepairs,
  type ManagedVshudPairingRepairDeps
} from '../../managed-server/lifecycle/vshud-managed-pairing-repair'

import { VshudManagedPairingRepairFailedError } from '../../managed-server/lifecycle/vshud-managed-pairing-repair-failure'
import { notifyManagedVshudPairingRepaired } from '../../managed-server/lifecycle/vshud-managed-pairing-repaired-listener'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'
import { type WslVshudHostTransport, createWslVshudHostTransport } from './wsl-vshud-host-transport'
import type { WslVshudPairingRecovery } from './wsl-vshud-pairing-identity'

type WslVshudHostAccess = { target: WslVshudHostTarget; connection: WslVshudHostTransport }

export function liveWslVshudPairingRepairDeps(
  userDataPath: string
): ManagedVshudPairingRepairDeps<WslVshudHostAccess> {
  const record = async (environmentId: string) => {
    const found = await findWslHostDeployment(userDataPath, environmentId)
    if (!found) {
      throw new VshudManagedPairingRepairFailedError('this server is not a WSL host')
    }
    return found
  }
  return {
    resolve: async (environmentId) => await resolveEnvironment(userDataPath, environmentId),
    connect: async (environment: KnownRuntimeEnvironment) => {
      const target: WslVshudHostTarget = {
        kind: 'wsl',
        id: environment.id,
        distro: (await record(environment.id)).distro,
        label: environment.name
      }
      return { target, connection: createWslVshudHostTransport({ target }) }
    },
    readReadiness: async (access) => {
      try {
        return await readActiveManagedVshudReadiness(access)
      } finally {
        access.connection.dispose()
      }
    },
    ports: async (environment) => {
      const found = await findWslHostDeployment(userDataPath, environment.id)
      return found ? { localPort: found.localPort, remotePort: found.remotePort } : null
    },
    refresh: async (environmentId, pairingCode) => {
      const { localPort, remotePort } = await record(environmentId)
      return (
        await refreshWslHostPairing(userDataPath, environmentId, {
          pairingCode,
          localPort,
          remotePort
        })
      ).environment
    },
    repaired: notifyManagedVshudPairingRepaired,
    now: Date.now
  }
}

/** One gate per desktop, so the cap and a standing failure hold across every WSL connect. */
export function createWslVshudPairingRecovery(
  userDataPath: string,
  deps: ManagedVshudPairingRepairDeps<WslVshudHostAccess> = liveWslVshudPairingRepairDeps(
    userDataPath
  )
): Omit<WslVshudPairingRecovery, 'environmentId'> {
  return { repairs: new ManagedVshudPairingRepairs(deps), resolve: deps.resolve }
}
