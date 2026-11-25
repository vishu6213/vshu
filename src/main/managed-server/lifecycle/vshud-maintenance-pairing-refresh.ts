import { refreshManagedVshudPairing } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  getVshudSshDeployment,
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { ServeReadiness } from '../../server/serve-readiness'
import { tunneledVshudPairingCode } from './vshud-tunneled-pairing'

/** Saves the pairing a managed server published after an update, rollback or restart. */
export async function refreshMaintainedVshudPairing(
  userDataPath: string,
  environmentId: string,
  readiness: ServeReadiness
): Promise<KnownRuntimeEnvironment> {
  // Reuse the enrolled grant after restart so pairing cannot replace this desktop’s identity (#29042).
  // Re-read because census may have repaired pairing or moved the tunnel port meanwhile.
  const current = await resolveEnvironment(userDataPath, environmentId)
  const localPort = getVshudSshDeployment(current)?.localPort
  if (localPort === undefined) {
    throw new Error('This server is no longer managed over SSH.')
  }
  const enrolled = getPreferredPairingOffer(current)
  const pairingCode = tunneledVshudPairingCode(readiness, localPort, enrolled)
  return await refreshManagedVshudPairing(userDataPath, environmentId, pairingCode)
}
