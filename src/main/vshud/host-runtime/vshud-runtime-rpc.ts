import { VshuRuntimeRpcServer } from '../../runtime/rpc/server/runtime-rpc'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import type { VshudOptions } from '../serve-startup/vshud-start-contract'
import { resolveVshudWebClientRoot } from '../serve-startup/vshud-command-arguments'
import {
  clearDesktopRuntimeFallbackPort,
  vshudWsPortOptions
} from '../serve-startup/vshud-ws-port-policy'

export function createVshudRuntimeRpcServer(
  runtime: VshuRuntimeService,
  userDataPath: string,
  options: VshudOptions,
  bindHost: string
): VshuRuntimeRpcServer {
  clearDesktopRuntimeFallbackPort(userDataPath)
  return new VshuRuntimeRpcServer({
    runtime,
    userDataPath,
    enableWebSocket: true,
    // Pin operator exposure across restarts; pairing must not silently widen a loopback bind.
    pinnedBindHost: bindHost,
    serveNetworkSources: {
      allowPublic: options.allowPublic === true,
      refusePublic: options.refusePublic === true,
      pairingAddress: options.pairingAddress ?? null
    },
    webClientRoot: resolveVshudWebClientRoot(options.webClientRoot),
    ...vshudWsPortOptions(options.port)
  })
}
