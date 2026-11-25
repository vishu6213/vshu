import {
  getPreferredPairingOffer,
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  readManagedVshudPublishedKey,
  readManagedVshudPublishedPort,
  resolveManagedVshudTunnelPort,
  type VshudTunnelPortInput
} from './vshud-managed-bound-port'
import {
  VshudManagedIdentityError,
  vshudIdentityRefusal,
  verifyManagedVshudTunnelIdentity,
  type VshudTunnelIdentity
} from './vshud-managed-tunnel-identity'
import { managedVshudSlot } from './vshud-managed-runtime-context'
import { VshudCrashLoopError, wakeManagedVshudUnlessCrashLooping } from './vshud-managed-crash-loop'
import { resolveVshudRemoteContext } from '../install/vshud-remote-context'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type { PortForwardEntry } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { SshPortForwardManager } from '../../ssh/port-forwarding/ssh-port-forward'

export type VshudManagedTunnelTargeting = {
  resolveRemotePort: (input: VshudTunnelPortInput) => Promise<number>
  verifyIdentity: (environment: KnownRuntimeEnvironment) => Promise<VshudTunnelIdentity>
  /** Wake only proven-stopped slots before rereading ports after foreign answers. */
  wakeStoppedServer?: (input: VshudTunnelPortInput) => Promise<void>
  readPublishedPort?: (input: VshudTunnelPortInput) => Promise<number | null>
  /** The server key this host's own slot publishes; null when unreadable. */
  readPublishedKey?: (input: VshudTunnelPortInput) => Promise<string | null>
}

/** `replaced`: the host's own slot answers SSH with a server key other than the pinned one. */
export type VshudForwardIdentity =
  | VshudTunnelIdentity
  | { verdict: 'replaced'; detail: string; environment: { id: string; name: string } }

export const MANAGED_VSHUD_TUNNEL_TARGETING: VshudManagedTunnelTargeting = {
  resolveRemotePort: resolveManagedVshudTunnelPort,
  verifyIdentity: verifyManagedVshudTunnelIdentity,
  wakeStoppedServer: wakeStoppedManagedVshudForTunnel,
  readPublishedPort: readManagedVshudPublishedPort,
  readPublishedKey: readManagedVshudPublishedKey
}

// Stopped slots may have lost their port; waking publishes a new free port for the reread.
async function wakeStoppedManagedVshudForTunnel(input: VshudTunnelPortInput): Promise<void> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    return
  }
  let wake: Awaited<ReturnType<typeof wakeManagedVshudUnlessCrashLooping>>
  try {
    const context = await resolveVshudRemoteContext(input.target, input.connection)
    wake = await wakeManagedVshudUnlessCrashLooping(
      input.environment.id,
      input.target.label,
      managedVshudSlot(context, access.remotePort)
    )
  } catch (error) {
    // Failed wake does not settle identity; reread and validate the resulting forward.
    console.warn('[ssh] Could not start the managed Vshu server behind a foreign answer:', error)
    return
  }
  // The crash-loop reason beats the foreign-port mismatch the reread would report.
  if (wake.outcome === 'crash-loop') {
    throw new VshudCrashLoopError(wake.detail)
  }
}

/** Tests may trust persisted ports without an identity round trip. */
export const PERSISTED_PORT_TARGETING: VshudManagedTunnelTargeting = {
  resolveRemotePort: async ({ environment }) => getRuntimeSshAccess(environment)?.remotePort ?? 0,
  verifyIdentity: async () => ({ verdict: 'verified' })
}

type VerifiedVshudForwardArgs = {
  targetId: string
  connection: SshConnection
  forwards: SshPortForwardManager
  localPort: number
  label: string
  remotePort: number
  /** Without a reread, foreign answers fail immediately. */
  rereadRemotePort?: () => Promise<number>
  /** Omit when the caller validates identity itself. */
  verify?: (localPort: number) => Promise<VshudForwardIdentity>
  stillCurrent: () => boolean | Promise<() => boolean>
}

export type VshudTunnelStartChecks = Pick<
  VerifiedVshudForwardArgs,
  'rereadRemotePort' | 'verify'
> & {
  /** Persisted preferred port when the server bound elsewhere. */
  preferredPort?: number
}

export async function environmentForwardChecks(
  targeting: VshudManagedTunnelTargeting,
  input: VshudTunnelPortInput
): Promise<Required<Pick<VerifiedVshudForwardArgs, 'remotePort' | 'rereadRemotePort' | 'verify'>>> {
  return {
    remotePort: await targeting.resolveRemotePort(input),
    rereadRemotePort: async () => {
      await targeting.wakeStoppedServer?.(input)
      return targeting.resolveRemotePort(input)
    },
    verify: async () => {
      const identity = await targeting.verifyIdentity(input.environment)
      if (identity.verdict !== 'foreign' || !targeting.readPublishedKey) {
        return identity
      }
      // A refusal from the slot's own new server is a replaced pairing, not a port another Vshu took.
      const publishedKey = await targeting.readPublishedKey(input)
      return publishedKey &&
        publishedKey !== getPreferredPairingOffer(input.environment).publicKeyB64
        ? { verdict: 'replaced', detail: identity.detail, environment: input.environment }
        : identity
    }
  }
}

/** Remove superseded forwards; retry foreign ports once. Pinned-server token refusals fail immediately. */
export async function forwardToVerifiedVshud(
  args: VerifiedVshudForwardArgs
): Promise<PortForwardEntry | null> {
  let remotePort = args.remotePort
  for (let attempt = 0; ; attempt++) {
    const forward = await addCurrentForward(args, remotePort)
    if (!forward) {
      return null
    }
    const identity = args.verify
      ? await args.verify(forward.localPort)
      : ({ verdict: 'verified' } as const)
    if (!(await prepareCurrentTunnelCheck(args.stillCurrent))()) {
      await args.forwards.removeForwardAndWait(forward.id)
      return null
    }
    if (identity.verdict === 'verified' || identity.verdict === 'unreachable') {
      if (identity.verdict === 'unreachable') {
        // Unreachable servers may be down or starting; this is not proof of a foreign server.
        console.warn(
          `[ssh] Managed Vshu server did not answer through its tunnel: ${identity.detail}`
        )
      }
      return forward
    }
    await args.forwards.removeForwardAndWait(forward.id)
    // Token refusal from our pinned server is not a moved port; waking cannot repair pairing.
    if (identity.verdict === 'unpaired') {
      throw vshudIdentityRefusal(remotePort, identity)
    }
    // Rereading the port cannot reach the pinned server once the slot itself serves another key.
    if (identity.verdict === 'replaced') {
      throw VshudManagedIdentityError.replacedServer(identity.environment, identity.detail)
    }
    const reread =
      attempt === 0 && args.rereadRemotePort ? await args.rereadRemotePort() : remotePort
    if (reread === remotePort || !(await prepareCurrentTunnelCheck(args.stillCurrent))()) {
      throw vshudIdentityRefusal(remotePort, identity)
    }
    remotePort = reread
  }
}

async function addCurrentForward(
  args: VerifiedVshudForwardArgs,
  remotePort: number
): Promise<PortForwardEntry | null> {
  const forward = await args.forwards.addForward(
    args.targetId,
    args.connection,
    args.localPort,
    '127.0.0.1',
    remotePort,
    args.label
  )
  if (args.localPort !== 0 && forward.localPort !== args.localPort) {
    await args.forwards.removeForwardAndWait(forward.id)
    throw new Error('Managed Vshu tunnel bound an unexpected local port.')
  }
  if (!(await prepareCurrentTunnelCheck(args.stillCurrent))()) {
    await args.forwards.removeForwardAndWait(forward.id)
    return null
  }
  return forward
}

async function prepareCurrentTunnelCheck(
  check: VerifiedVshudForwardArgs['stillCurrent']
): Promise<() => boolean> {
  const current = await check()
  return typeof current === 'function' ? current : () => current
}
