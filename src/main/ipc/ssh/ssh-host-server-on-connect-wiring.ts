import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import {
  getManagedVshudFenceEnvironmentId,
  managedVshudServerName
} from '../../../shared/remote-runtime/ssh/managed-vshud-ssh-owner'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findVshudMigrationSourceCutoverForTarget } from '../../persistence/migrating-vshud-catalog/cutover-journals/vshud-migration-cutover-journal'
import { abandonVshudConversion } from '../../managed-server/migration/cutover/vshud-conversion-abandon'
import { retainVshudMigrationSource } from '../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-source-retention'
import { enableMovedVshudAutomationsForTarget } from '../../persistence/migrating-vshud-catalog/retained-source/vshud-migration-moved-automations'
import { hasVshudTemplate } from '../../vshud/artifact-slots/vshud-artifact-materializer'
import { isVshudHostUnavailableFixableOnHost } from '../../vshud/diagnostics/vshud-host-unavailable'
import { managedServerUpdateDeps } from '../../ssh/host-server/managed-server-update-deps'
import { ensureVshudManagedTunnel } from '../../managed-server/lifecycle/vshud-managed-tunnel'
import { verifyVshudManagedServing } from '../../managed-server/lifecycle/vshud-managed-serving-verify'
import { convertSshTargetToManagedVshud } from '../../managed-server/lifecycle/vshud-runtime-conversion'
import {
  vshudMigrationDestinationFor,
  vshudServerAutomationEnablerFor,
  vshudServerFolderCatalogFor,
  vshudServerRepositoriesFor
} from '../../managed-server/lifecycle/vshud-runtime-conversion-wiring'
import { createManagedVshudEnvironment } from '../../managed-server/lifecycle/vshud-runtime-deployment'
import type { HostServerOnConnectDeps } from '../../ssh/host-server/ssh-host-server-on-connect'
import {
  censusSshHostRelaysBeforeSession,
  relayTerminalsOnConnect
} from '../../ssh/legacy-relay/endpoints/ssh-host-relay-terminals-on-connect'
import { requireManagedVshudInfrastructure } from '../../managed-server/lifecycle/vshud-managed-runtime-context'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/endpoints/ssh-host-relay-census-for-target'
import { setSshHostServerStatus } from '../../ssh/host-server/ssh-host-server-status'
import { trackSshHostServerEvent } from '../../ssh/host-server/ssh-host-server-telemetry'
import { knownSshHostPlatform } from '../../ssh/remote-host/ssh-host-platform-memo'
import { knownVshudTunnelTransport } from '../../managed-server/lifecycle/vshud-tunnel-transport-memo'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { releaseUnreachableVshudSetup } from '../../managed-server/migration/cutover/vshud-unreachable-setup-release'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { broadcastSshState } from './ssh-renderer-broadcast'
import { connectInFlight } from './ssh-connect-attempt-registry'
import { startLegacyRelayBridge } from '../../ssh/legacy-relay/bridge/legacy-relay-bridge-registry'
import { isBridgeableLease } from '../../ssh/legacy-relay/bridge/legacy-relay-bridge-leases'

export function hostServerOnConnectDeps(userDataPath: string): HostServerOnConnectDeps {
  const registry = getSshTargetRegistryStore()!
  const claims = registry.getVshudRuntimeClaims()
  const store = registry.getVshudMigrationSource()
  const appVersion = getAppEnvironment().getVersion()
  const isRegistered = async (environmentId: string): Promise<boolean> =>
    (await listEnvironments(userDataPath)).some((entry) => entry.id === environmentId)
  return {
    // A fence alone may be unfinished setup; only registered servers count.
    managedEnvironmentId: async (target) => {
      const environmentId = getManagedVshudFenceEnvironmentId(target)
      return environmentId && (await isRegistered(environmentId)) ? environmentId : null
    },
    ensureTunnel: async (environmentId) => {
      await ensureVshudManagedTunnel(userDataPath, environmentId)
    },
    ensureServing: (environmentId) => verifyVshudManagedServing(userDataPath, environmentId),
    retainCommittedSource: async (target) => {
      const head = findVshudMigrationSourceCutoverForTarget(userDataPath, target.id)
      if (head?.phase !== 'destination-committed') {
        return 0
      }
      await retainVshudMigrationSource(userDataPath, head.migrationId, store)
      // Retry what earlier connects could not reach the server to re-enable.
      const environment = (await listEnvironments(userDataPath)).find(
        (entry) => entry.id === head.destinationEnvironmentId
      )
      return environment
        ? enableMovedVshudAutomationsForTarget(
            userDataPath,
            target.id,
            vshudServerAutomationEnablerFor(environment)
          )
        : 0
    },
    hasTemplate: hasVshudTemplate,
    recordedUnavailable: (target) =>
      target.managedServerUnavailable?.appVersion === appVersion
        ? target.managedServerUnavailable.reason
        : null,
    recordUnavailable: (target, reason) => {
      if (!isVshudHostUnavailableFixableOnHost(reason)) {
        registry.updateTarget(target.id, { managedServerUnavailable: { reason, appVersion } })
      }
    },
    ...managedServerUpdateDeps(userDataPath),
    isEmptyHost: (target) => {
      // An interrupted empty-host deploy passes its own claim, recorded by its provisioning intent.
      const environmentId = getManagedVshudFenceEnvironmentId(target)
      return claims.preflight(
        target.id,
        environmentId
          ? { environmentId, recorded: target.vshudProvisioning !== undefined }
          : undefined
      ).claimable
    },
    relayTerminals: (target) =>
      relayTerminalsOnConnect({
        store,
        targetId: target.id,
        censusHost: async () =>
          censusSshHostRelaysBeforeSession(
            await requireManagedVshudInfrastructure().connectionManager.connect(target),
            target.id
          )
      }),
    deploy: (target) =>
      createManagedVshudEnvironment(userDataPath, {
        name: target.vshudProvisioning?.name ?? managedVshudServerName(target),
        sshTargetId: target.id
      }),
    convert: async (target, hostProof) => {
      // COMPAT(legacy-relay-bridge): find the panes old relays still run before the tabs remount.
      if (hostProof?.bridged) {
        await startLegacyRelayBridge(target.id)
      }
      const converted = await convertSshTargetToManagedVshud(userDataPath, {
        sshTargetId: target.id,
        name: managedVshudServerName(target),
        // The connect's own census already answered; a conversion before any session reuses it.
        censusHost: (host) =>
          hostProof ? Promise.resolve(hostProof) : censusHostRelayTerminalsFor(host)(),
        isBridgedPaneLease: isBridgeableLease,
        // Releasing the direct session here would cancel the connect that requested conversion.
        destinationFor: vshudMigrationDestinationFor,
        serverRepositoriesFor: vshudServerRepositoriesFor,
        serverFolderCatalogFor: vshudServerFolderCatalogFor,
        serverAutomationEnablerFor: vshudServerAutomationEnablerFor
      })
      // A quiet retry's refusal is not the user's attempt, so it keeps their consent.
      const quiet = connectInFlight.get(target.id)?.quiet?.active === true
      if (converted.outcome === 'converted' || (converted.outcome === 'refused' && !quiet)) {
        // Move-anyway consent covers one attempt; retain it on failure so held-fence verification can resume.
        registry.updateTarget(target.id, { managedServerLeaveBehind: undefined })
      }
      return converted
    },
    abandonDeploy: async (target) => {
      const environmentId =
        getManagedVshudFenceEnvironmentId(target) ??
        getManagedVshudFenceEnvironmentId(registry.getTarget(target.id))
      if (environmentId && !(await isRegistered(environmentId))) {
        claims.release(target.id, environmentId)
        await claims.flush()
      }
    },
    hasUnfinishedConversion: (target) => {
      const head = findVshudMigrationSourceCutoverForTarget(userDataPath, target.id)
      return (
        head !== null &&
        !head.supersedesMigrationId &&
        (head.phase === 'source-fenced' || head.phase === 'destination-staged')
      )
    },
    abandonConversion: async (target) => {
      await abandonVshudConversion({
        userDataPath,
        store,
        claims,
        targetId: target.id,
        destinationFor: vshudMigrationDestinationFor
      })
    },
    isFencedBeforeStaging: (target) =>
      findVshudMigrationSourceCutoverForTarget(userDataPath, target.id)?.phase === 'source-fenced',
    releaseUnreachableSetup: (target) =>
      releaseUnreachableVshudSetup({ userDataPath, claims, targetId: target.id }),
    // Read at report time: a deploy or conversion learns the platform while the decision runs.
    report: (target, event) =>
      trackSshHostServerEvent(
        event,
        knownSshHostPlatform(target.id),
        knownVshudTunnelTransport(target.id)
      ),
    progress: (target, phase) => {
      // Cancelled decisions keep running; their progress must not revive connection status.
      const attempt = connectInFlight.get(target.id)
      if (!attempt || attempt.quiet?.active) {
        return
      }
      setSshHostServerStatus(target.id, { kind: 'setting-up', phase })
      broadcastSshState(getCurrentMainWindow, target.id, {
        targetId: target.id,
        status: 'connecting',
        error: null,
        reconnectAttempt: 0
      })
    }
  }
}
