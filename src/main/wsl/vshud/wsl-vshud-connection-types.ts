import type { WslHostDeferredUpdate } from '../../../shared/remote-runtime/wsl-hosts/wsl-host-types'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { VshudTunnelIdentity } from '../../managed-server/lifecycle/vshud-managed-tunnel-identity'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import type { WslVshudConnectionStatus } from './wsl-vshud-connection-status'
import type { WslVshudDeployOptions, WslVshudLaunch } from './wsl-vshud-launch-contract'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'
import type { WslVshudPairingRecovery } from './wsl-vshud-pairing-identity'
import type { WslVshudStdioBridgeOptions } from './wsl-vshud-stdio-bridge'

/** One open bridge to a distro's vshud, as the connection manager publishes it. */
export type WslVshudConnection = {
  distro: string
  environmentId: string
  /** The loopback port on this machine the pairing offer points at. */
  localPort: number
  /** vshud's port inside the distro. */
  remotePort: number
  fullVersion: string
  /** vshud's pid inside the distro, from its pid file; null when unreadable. */
  pid: number | null
  /** vshud's pairing code, with its endpoint rewritten to `ws://127.0.0.1:<localPort>`. */
  pairingOffer: string
  /** An app update the incumbent `fullVersion` is waiting to take (live terminals). */
  deferredUpdate: WslHostDeferredUpdate | null
  close(): Promise<void>
}

export type WslVshudConnectionDependencies = {
  holder?: WslDistroHolder
  getPairingOffer?: (environmentId: string) => PairingOffer | null | Promise<PairingOffer | null>
  /** The bridge port the host's record saved: rebinding it keeps the pairing across app restarts. */
  recordedLocalPort?: (environmentId: string) => number | null | Promise<number | null>
  deployAndLaunch?: (distro: string, options: WslVshudDeployOptions) => Promise<WslVshudLaunch>
  createTransport?: (target: WslVshudHostTarget) => VshudHostTransport
  listen?: (
    transport: VshudHostTransport,
    options: WslVshudStdioBridgeOptions
  ) => Promise<StartedPortForward>
  verifyIdentity?: (pairingOffer: string, readiness: ServeReadiness) => Promise<VshudTunnelIdentity>
  /** Re-pairs a refused enrolled token; without it a refusal fails the connect. */
  pairingRecovery?: Omit<WslVshudPairingRecovery, 'environmentId'>
  /** A connection (re)opened, its offer changed, or its status moved; null once it closed. */
  onChange?: (
    distro: string,
    connection: WslVshudConnection | null,
    status: WslVshudConnectionStatus
  ) => void
}
