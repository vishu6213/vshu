// Lost channels drop their sockets but keep the listener; tunnel reconnect logic owns recovery.
import { VshudStdioBridgeUnavailableError } from '../../vshud/diagnostics/vshud-host-unavailable'
import type { VshudHostTransport } from '../install/vshud-host-transport'
import {
  checkVshudStdioBridge,
  openVshudStdioBridgeChannel,
  resolveVshudStdioBridge,
  type VshudStdioBridge
} from './vshud-stdio-bridge'
import { listenVshudStdioBridge } from './vshud-stdio-bridge-listener'

import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'

export type VshudStdioBridgeDependencies = {
  resolveBridge: (conn: VshudHostTransport, port: number) => Promise<VshudStdioBridge>
  checkBridge: (conn: VshudHostTransport, bridge: VshudStdioBridge) => Promise<unknown>
  openChannel: (conn: VshudHostTransport, bridge: VshudStdioBridge) => Promise<RemoteCommandChannel>
}

export const VSHUD_STDIO_BRIDGE_DEPENDENCIES: VshudStdioBridgeDependencies = {
  resolveBridge: resolveVshudStdioBridge,
  checkBridge: checkVshudStdioBridge,
  openChannel: openVshudStdioBridgeChannel
}

export class VshudStdioBridgePortForwardProvider implements SshPortForwardProvider {
  constructor(
    private readonly dependencies: VshudStdioBridgeDependencies = VSHUD_STDIO_BRIDGE_DEPENDENCIES
  ) {}

  canHandle(conn: SshConnection): boolean {
    return conn.getClient() !== null || conn.usesSystemSshTransport()
  }

  start(conn: SshConnection, options: PortForwardStartOptions): Promise<StartedPortForward> {
    return startVshudStdioBridge(conn, options, this.dependencies)
  }
}

export async function startVshudStdioBridge(
  host: VshudHostTransport,
  options: PortForwardStartOptions,
  deps: VshudStdioBridgeDependencies,
  maxChannels?: number
): Promise<StartedPortForward> {
  let bridge: Promise<VshudStdioBridge> | null = null
  // Retry failed bridge resolution on the next socket.
  const resolveBridge = (): Promise<VshudStdioBridge> => {
    bridge ??= deps.resolveBridge(host, options.remotePort).catch((error: unknown) => {
      bridge = null
      throw error
    })
    return bridge
  }
  try {
    await deps.checkBridge(host, await resolveBridge())
  } catch (error) {
    if (error instanceof VshudStdioBridgeUnavailableError) {
      throw error
    }
    // Lost contact does not prove bridge absence; let new sockets resolve it again.
    console.warn('[ssh] Vshu stdio bridge check was unverifiable:', error)
  }
  return listenVshudStdioBridge(
    options,
    async () => {
      const resolved = await resolveBridge()
      return { channel: await deps.openChannel(host, resolved), mode: resolved.mode }
    },
    maxChannels
  )
}
