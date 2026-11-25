// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { VSHUD_MANAGED_REMOTE_PORT } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/hosts/identity/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { vshudBoundPort } from './vshud-managed-bound-port'
import { tunneledVshudPairingCode } from './vshud-tunneled-pairing'
import { VshudManagedPairingRepairFailedError } from './vshud-managed-pairing-repair-failure'
import { quotePosixShellUnlessPlain } from '../../../shared/shell/launch/shell-argument-quoting'
import { RUNTIME_SERVER_REPLACED_STATUS_CODE } from '../../../shared/remote-runtime/host-status/runtime-host-status'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type VshudTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const VSHUD_IDENTITY_MISMATCH_CODE = 'vshud_identity_mismatch'

/** `foreign-port`: another process answered; `replaced-server`: the host's own slot serves another key. */
export type VshudIdentityMismatchKind = 'foreign-port' | 'replaced-server'

export class VshudManagedIdentityError extends Error {
  readonly code = VSHUD_IDENTITY_MISMATCH_CODE
  private constructor(
    readonly kind: VshudIdentityMismatchKind,
    explanation: string,
    detail: string
  ) {
    super(`${VSHUD_IDENTITY_MISMATCH_CODE}: ${explanation}: ${detail}`)
    this.name = 'VshudManagedIdentityError'
  }

  static foreignPort(remotePort: number, detail: string): VshudManagedIdentityError {
    return new VshudManagedIdentityError(
      'foreign-port',
      `the server on remote port ${remotePort} is not this host’s Vshu server ` +
        '(another Vshu may be using that port)',
      detail
    )
  }

  /** SSH access alone can't re-pin a different server key, so only the user can re-pair. */
  static replacedServer(
    environment: { id: string; name: string },
    detail: string
  ): VshudManagedIdentityError {
    const environmentName = environment.name
    // Why the id: a name is free text, so pasting it into a shell could expand or pick another server.
    const selector = quotePosixShellUnlessPlain(environment.id)
    return new VshudManagedIdentityError(
      'replaced-server',
      `${environmentName} is not the Vshu server this desktop paired with (Vshu now connects ` +
        'to the host as a different SSH user, or the server was reinstalled), so reconnecting ' +
        `won’t restore access. To pair with the host’s current server, open the ⋯ menu on ` +
        `${environmentName} in Settings › Remote Vshu Servers and choose Forget… (or run ` +
        `\`vshu environment forget --environment ${selector} --yes\`), then click ` +
        'Connect on the SSH host',
      detail
    )
  }
}

/** Status code of a refusal automatic retries can't clear (the pairing must change); null otherwise. */
export function managedVshudRefusalNeedingUserCode(error: unknown): string | null {
  if (error instanceof VshudManagedIdentityError && error.kind === 'replaced-server') {
    return RUNTIME_SERVER_REPLACED_STATUS_CODE
  }
  return error instanceof VshudManagedPairingRepairFailedError ? 'unauthorized' : null
}

export const VSHUD_PAIRING_REJECTED_CODE = 'vshud_pairing_rejected'

export class VshudManagedPairingRejectedError extends Error {
  readonly code = VSHUD_PAIRING_REJECTED_CODE
  constructor(detail: string) {
    super(
      `${VSHUD_PAIRING_REJECTED_CODE}: this host’s Vshu server no longer accepts ` +
        `this desktop's pairing (its saved devices were reset, or this desktop was removed ` +
        `there), so reconnecting alone won't restore access: ${detail}`
    )
    this.name = 'VshudManagedPairingRejectedError'
  }
}

export function vshudIdentityRefusal(
  remotePort: number,
  identity: Exclude<VshudTunnelIdentity, { verdict: 'verified' }>
): Error {
  return identity.verdict === 'unpaired'
    ? new VshudManagedPairingRejectedError(identity.detail)
    : VshudManagedIdentityError.foreignPort(remotePort, identity.detail)
}

// Key rejection closes the socket instead of returning a status reply.
const FOREIGN_CLOSE_CODES = new Set([4001, 4003])

export function classifyVshudTunnelIdentityFailure(error: unknown): VshudTunnelIdentity {
  const detail = error instanceof Error ? error.message : String(error)
  // Only sealed access-grant refusals prove the pinned server answered.
  if (
    error instanceof RemoteRuntimeClientError &&
    error.code === 'unauthorized' &&
    error.pairingStage === 'access-grant'
  ) {
    return { verdict: 'unpaired', detail }
  }
  if (error instanceof RemoteRuntimeClientError && FOREIGN_CLOSE_CODES.has(error.closeCode ?? 0)) {
    return { verdict: 'foreign', detail }
  }
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
    ? { verdict: 'unreachable', detail }
    : { verdict: 'foreign', detail }
}

export async function verifyVshudPairingIdentity(
  connection: PairedRuntimeConnection,
  expected: Pick<KnownRuntimeEnvironment, 'runtimeId' | 'pairedDeviceId'>
): Promise<VshudTunnelIdentity> {
  try {
    await verifyRuntimePairingIdentity(connection, expected)
    return { verdict: 'verified' }
  } catch (error) {
    return classifyVshudTunnelIdentityFailure(error)
  }
}

export function verifyManagedVshudTunnelIdentity(
  environment: KnownRuntimeEnvironment
): Promise<VshudTunnelIdentity> {
  if (!environment.vshudDeployment) {
    return Promise.resolve({ verdict: 'verified' })
  }
  // Runtime/device IDs can change or become stale; pinned-key handshake and token acceptance prove identity.
  return verifyVshudPairingIdentity(getPreferredPairedRuntimeConnection(environment), {
    runtimeId: null
  })
}

/** Fresh deploys have no saved pairing; reread readiness after foreign answers to follow port changes. */
export function deployedVshudTunnelChecks(
  initial: ServeReadiness,
  rereadReadiness: () => Promise<ServeReadiness>
) {
  let readiness = initial
  return {
    readiness: () => readiness,
    remotePort: vshudBoundPort(initial) ?? VSHUD_MANAGED_REMOTE_PORT,
    rereadRemotePort: async () => {
      readiness = await rereadReadiness()
      return vshudBoundPort(readiness) ?? VSHUD_MANAGED_REMOTE_PORT
    },
    verify: async (localPort: number): Promise<VshudTunnelIdentity> => {
      const pairing = parsePairingCode(tunneledVshudPairingCode(readiness, localPort))
      return pairing
        ? verifyVshudPairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
            runtimeId: readiness.runtimeId || null
          })
        : { verdict: 'foreign', detail: 'This host’s Vshu server published an invalid pairing.' }
    }
  }
}
