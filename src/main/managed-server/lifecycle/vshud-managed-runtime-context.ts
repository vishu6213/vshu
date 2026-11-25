import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  isVshudUncountedTerminalsDeferral,
  VSHUD_UPDATE_TERMINALS_RUNNING_CODE
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import {
  getVshudSshDeployment,
  type KnownRuntimeEnvironment,
  type VshudSshDeploymentLink
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { getManagedVshudFenceEnvironmentId } from '../../../shared/remote-runtime/ssh/managed-vshud-ssh-owner'
import type { ServeReadiness } from '../../server/serve-readiness'
import { computeLocalVshudBuildHash } from '../install/vshud-local-build-hash'

import type { VshudHostTarget } from '../install/vshud-host-transport'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'
import {
  admitConfirmedIncumbent,
  admitVshudRecordForIntent,
  type VshudUpdateIntent
} from './vshud-managed-update-decision'
import {
  type VshudTerminalCensus,
  UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import { probeActiveVshudReadiness } from '../activation/vshud-active-readiness'
import { resolveVshudRemoteContext, type VshudRemoteContext } from '../install/vshud-remote-context'
import { VSHUD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'

const VSHUD_BIND_HOST = '127.0.0.1'

// Pinned slots must fail on absent markers rather than silently use host Node.
const MANAGED_VSHUD_LEGACY_NODE_PATH = ''

export function requireManagedVshudInfrastructure() {
  const targetStore = requireManagedVshudTargetStore()
  const connectionManager = getSshConnectionManager()
  if (!connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s Vshu server is unverifiable.')
  }
  return { connectionManager, targetStore, claims: targetStore.getVshudRuntimeClaims() }
}

export function requireManagedVshudTargetStore() {
  const targetStore = getSshTargetRegistryStore()
  if (!targetStore) {
    throw new Error('SSH target state is unavailable; this host’s Vshu server is unverifiable.')
  }
  return targetStore
}

export async function requireManagedVshudEnvironment(
  userDataPath: string,
  selector: string
): Promise<{ environment: KnownRuntimeEnvironment; deployment: VshudSshDeploymentLink }> {
  const environment = await resolveEnvironment(userDataPath, selector)
  const deployment = getVshudSshDeployment(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('This server is not managed through an vshud SSH deployment.')
  }
  return { environment, deployment }
}

export async function resolveLinkedVshudContext(
  environment: KnownRuntimeEnvironment,
  deployment: VshudSshDeploymentLink,
  signal?: AbortSignal
): Promise<VshudRemoteContext> {
  const { connectionManager, targetStore } = requireManagedVshudInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (
    !target ||
    target.generation !== deployment.sshTargetGeneration ||
    getManagedVshudFenceEnvironmentId(target) !== environment.id
  ) {
    throw new Error('The SSH registration for this host’s Vshu server is no longer valid.')
  }
  const connection = await connectionManager.connect(target)
  return resolveVshudRemoteContext(target, connection, signal)
}

export function managedVshudSlot(
  context: VshudRemoteContext<VshudHostTarget>,
  port: number,
  signal?: AbortSignal
) {
  return {
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    nodePath: MANAGED_VSHUD_LEGACY_NODE_PATH,
    userDataDir: context.userDataDir,
    bindHost: VSHUD_BIND_HOST,
    port,
    signal
  }
}

export function managedVshudInstallDir(
  context: VshudRemoteContext<VshudHostTarget>,
  version: string
): string {
  return computeRemoteInstallDir(
    VSHUD_INSTALL_MODEL,
    context.remoteHome,
    version,
    context.host.pathFlavor
  )
}

/** Accept readiness only from the build this client holds. */
export function probeManagedVshudReadiness(
  context: VshudRemoteContext<VshudHostTarget>,
  localVshudDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<ServeReadiness> {
  return probeActiveVshudReadiness(
    {
      conn: context.connection,
      host: context.host,
      remoteInstallDir: managedVshudInstallDir(context, fullVersion),
      signal
    },
    { buildHash: computeLocalVshudBuildHash(localVshudDir), fullVersion }
  )
}

export function managedVshudDeployPolicy(
  context: Pick<VshudRemoteContext<VshudHostTarget>, 'activationRecord'>,
  appVersion: string,
  intent: VshudUpdateIntent,
  /** Update anyway's confirmed incumbent: a build activated since then is refused. */
  confirmed?: { incumbentVersion: string | null }
): {
  census: VshudTerminalCensus
  recountCensus: () => Promise<VshudTerminalCensus>
  releaseIncumbentAdmission: () => Promise<void>
  censusRecord: VshudActivationRecord
  admitRecord: (record: VshudActivationRecord, candidateVersion: string) => string | null
} {
  // Only the active daemon can count sessions; guessing zero risks restarting live terminals.
  const census: VshudTerminalCensus = context.activationRecord.active
    ? UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
    : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  return {
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    censusRecord: context.activationRecord,
    // Only the fenced read can reject newer migrated state or rolled-back builds on this unlinked path.
    admitRecord: confirmed
      ? admitConfirmedIncumbent(
          admitVshudRecordForIntent(intent, appVersion),
          confirmed.incumbentVersion
        )
      : admitVshudRecordForIntent(intent, appVersion)
  }
}

// Force can override live terminal counts, and an answered uncounted census once the planner proves no daemon is running.
export function isForceableVshudDeferral(deferral: { code: string; forceable?: true }): boolean {
  return (
    deferral.code === VSHUD_UPDATE_TERMINALS_RUNNING_CODE ||
    (deferral.forceable === true && isVshudUncountedTerminalsDeferral(deferral.code))
  )
}
