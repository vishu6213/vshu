// Preferred ports may belong to other runtimes; tunnel to the active slot's published bound port.
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import { managedVshudInstallDir } from './vshud-managed-runtime-context'
import { resolveVshudRemoteContext } from '../install/vshud-remote-context'
import {
  parseVshudReadinessWaitOutput,
  readVshudReadinessNowCommand
} from '../install/vshud-remote-readiness-wait'
import {
  execVshudRemote,
  type VshudRemoteExecTarget
} from '../install/vshud-remote-runtime-control'
import type { VshudHostTarget, VshudHostTransport } from '../install/vshud-host-transport'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'

export type VshudTunnelPortInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: VshudHostTransport
}

export function vshudBoundPort(readiness: Pick<ServeReadiness, 'boundEndpoint'>): number | null {
  if (!readiness.boundEndpoint) {
    return null
  }
  try {
    const port = Number(new URL(readiness.boundEndpoint).port)
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

async function readManagedVshudSlotReadiness(
  target: VshudRemoteExecTarget & { remoteInstallDir: string }
): Promise<ServeReadiness | null> {
  const parsed = parseVshudReadinessWaitOutput(
    target.host,
    await execVshudRemote(
      target,
      readVshudReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return parsed.state === 'ready' ? parsed.readiness : null
}

export async function readActiveManagedVshudReadiness(input: {
  target: VshudHostTarget
  connection: VshudHostTransport
}): Promise<ServeReadiness | null> {
  const context = await resolveVshudRemoteContext(input.target, input.connection)
  const active = context.activationRecord.active
  if (!active) {
    return null
  }
  return readManagedVshudSlotReadiness({
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    remoteInstallDir: managedVshudInstallDir(context, active)
  })
}

async function readActiveSlotBoundPort(input: VshudTunnelPortInput): Promise<number | null> {
  if (!input.environment.vshudDeployment) {
    return null
  }
  const readiness = await readActiveManagedVshudReadiness(input)
  return readiness ? vshudBoundPort(readiness) : null
}

export async function resolveManagedVshudTunnelPort(input: VshudTunnelPortInput): Promise<number> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    throw new Error('Managed vshud environment is missing its SSH tunnel dependency.')
  }
  try {
    return (await readActiveSlotBoundPort(input)) ?? access.remotePort
  } catch (error) {
    // Post-forward identity validation still detects a wrong server when falling back.
    console.warn(
      '[ssh] Could not read the managed Vshu server port; trying the preferred one:',
      error
    )
    return access.remotePort
  }
}

/** Missing or unreadable published ports never justify moving an existing tunnel. */
export async function readManagedVshudPublishedPort(
  input: VshudTunnelPortInput
): Promise<number | null> {
  try {
    return await readActiveSlotBoundPort(input)
  } catch {
    return null
  }
}

/** The server key the active slot offers to new pairings; null when unpublished or unreadable. */
export async function readManagedVshudPublishedKey(
  input: VshudTunnelPortInput
): Promise<string | null> {
  if (!input.environment.vshudDeployment) {
    return null
  }
  try {
    const readiness = await readActiveManagedVshudReadiness(input)
    return readiness?.pairing.available
      ? (parsePairingCode(readiness.pairing.url)?.publicKeyB64 ?? null)
      : null
  } catch {
    return null
  }
}
