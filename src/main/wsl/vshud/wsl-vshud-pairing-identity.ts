import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  vshudIdentityRefusal,
  verifyVshudPairingIdentity,
  type VshudTunnelIdentity
} from '../../managed-server/lifecycle/vshud-managed-tunnel-identity'
import { tunneledVshudPairingCode } from '../../managed-server/lifecycle/vshud-tunneled-pairing'
import { getPreferredPairingOffer } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  buildWithPairingRepair,
  type ManagedVshudPairingRecovery
} from '../../managed-server/lifecycle/vshud-managed-tunnel-pairing-recovery'
import type { WslVshudLaunch } from './wsl-vshud-launch-contract'

/** The managed repair gate a refused enrolled token goes through, for one WSL host. */
export type WslVshudPairingRecovery = Omit<ManagedVshudPairingRecovery, 'ensure'> & {
  environmentId: string
}

/** Reconnect with enrolled token/pinned host key. Repair refusal once through the gate and verify the replacement; startup offers are for enrollment only. */
export async function resolveWslVshudPairing(
  launch: Extract<WslVshudLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity = verifyWslVshudIdentity,
  recovery?: WslVshudPairingRecovery
): Promise<string> {
  const verified = (offer: PairingOffer | null) =>
    verifyWslVshudPairing(launch, localPort, offer, verifyIdentity)
  // First-time pairing has no enrolled token to repair.
  if (!recovery || !paired) {
    return verified(paired)
  }
  let pairingOffer = ''
  await buildWithPairingRepair(
    {
      ...recovery,
      ensure: async (environment) => {
        pairingOffer = await verified(getPreferredPairingOffer(environment))
      }
    },
    recovery.environmentId,
    async () => {
      pairingOffer = await verified(paired)
    }
  )
  return pairingOffer
}

async function verifyWslVshudPairing(
  launch: Extract<WslVshudLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity: typeof verifyWslVshudIdentity
): Promise<string> {
  const pairingOffer = tunneledVshudPairingCode(launch.readiness, localPort, paired)
  const identity = await verifyIdentity(pairingOffer, launch.readiness)
  if (identity.verdict === 'foreign' || identity.verdict === 'unpaired') {
    throw vshudIdentityRefusal(launch.port, identity)
  }
  if (identity.verdict === 'unreachable') {
    console.warn(
      `[wsl] Vshu server in ${launch.distro} did not answer its bridge: ${identity.detail}`
    )
  }
  return pairingOffer
}

/** Whether the server behind a WSL bridge is the vshud that published `readiness`. */
export async function verifyWslVshudIdentity(
  pairingOffer: string,
  readiness: ServeReadiness
): Promise<VshudTunnelIdentity> {
  const offer = parsePairingCode(pairingOffer)
  return offer
    ? verifyVshudPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
        runtimeId: readiness.runtimeId || null
      })
    : { verdict: 'foreign', detail: 'The Vshu server in WSL published an invalid pairing offer.' }
}
