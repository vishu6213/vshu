import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshuRuntimeRpcServer } from '../../runtime/rpc/server/runtime-rpc'
import { buildServePairingReadiness } from '../../server/serve-pairing-readiness'
import type { VshudHealth } from '../diagnostics/vshud-health'
import type { VshudOptions } from './vshud-start-contract'

export async function buildVshudServeReadiness(input: {
  options: VshudOptions
  runtimeId: string
  rpc: Pick<VshuRuntimeRpcServer, 'getWebSocketEndpoint' | 'createPairingOffer'>
  collectHealth: () => Promise<VshudHealth>
}): Promise<ServeReadiness> {
  return {
    runtimeId: input.runtimeId,
    ...(await buildServePairingReadiness(input.options, input.rpc)),
    // WSL CLI reconciliation runs only in desktop launch, so no repair is pending here.
    managedWslCliReconciliation: 'settled',
    // Deployers inspect readiness health to reject hosts whose terminal daemon is unavailable.
    health: await input.collectHealth()
  }
}
