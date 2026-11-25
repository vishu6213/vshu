/** D2: each accepted loopback socket owns a pinned-Node wsl.exe stdio bridge. Avoid WSL localhost forwarding, whose startup refusal window and network-mode dependence make it unreliable. */
import {
  observeWslVshudBridgeChannel,
  type WslVshudBridgeChannelEvents
} from './wsl-vshud-bridge-activity'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import {
  VSHUD_STDIO_BRIDGE_DEPENDENCIES,
  startVshudStdioBridge,
  type VshudStdioBridgeDependencies
} from '../../managed-server/lifecycle/vshud-stdio-bridge-provider'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import { assertWslUncPathRunning } from '../filesystem/wsl-unc-access-gate'

// One wsl.exe per socket and no SSH MaxSessions to share; this only bounds a leaky client's spawns.
const WSL_VSHUD_STDIO_BRIDGE_MAX_CHANNELS = 64

export type WslVshudStdioBridgeOptions = {
  environmentId: string
  /** The distro each bridge child runs in; a dial is refused while it is stopped (E9). */
  distro: string
  /** vshud's loopback port inside the distro. */
  remotePort: number
  /** 0 picks a free one. */
  localPort: number
  label: string
  /** Each bridged socket's lifetime, for the liveness watch that rides the desktop's sockets. */
  events?: WslVshudBridgeChannelEvents
}

export function listenWslVshudStdioBridge(
  transport: VshudHostTransport,
  options: WslVshudStdioBridgeOptions,
  dependencies: VshudStdioBridgeDependencies = VSHUD_STDIO_BRIDGE_DEPENDENCIES
): Promise<StartedPortForward> {
  const { distro, events } = options
  return startVshudStdioBridge(
    transport,
    {
      id: `wsl-vshud:${options.environmentId}`,
      connectionId: options.environmentId,
      localHost: '127.0.0.1',
      localPort: options.localPort,
      remoteHost: '127.0.0.1',
      remotePort: options.remotePort,
      label: options.label
    },
    {
      ...dependencies,
      openChannel: async (conn, bridge) => {
        // A dial (a client's reconnect, a runtime call, the watch) is never a user act, and each
        // spawns wsl.exe, which boots a stopped distro. A user act boots it by connecting first.
        await assertWslUncPathRunning('', distro)
        const channel = await dependencies.openChannel(conn, bridge)
        return events ? observeWslVshudBridgeChannel(channel, events) : channel
      }
    },
    WSL_VSHUD_STDIO_BRIDGE_MAX_CHANNELS
  )
}

type WslVshudStdioBridgeListen = (
  transport: VshudHostTransport,
  options: WslVshudStdioBridgeOptions
) => Promise<StartedPortForward>

/** A persisted local port may be taken by now; a free one beats no connection. */
export async function listenWslVshudStdioBridgeOnPreferredPort(
  transport: VshudHostTransport,
  options: WslVshudStdioBridgeOptions,
  listen: WslVshudStdioBridgeListen = listenWslVshudStdioBridge
): Promise<StartedPortForward> {
  try {
    return await listen(transport, options)
  } catch (error) {
    if (options.localPort === 0) {
      throw error
    }
    console.warn(
      `[wsl] Could not rebind local port ${options.localPort}; picking another:`,
      error instanceof Error ? error.message : error
    )
    return listen(transport, { ...options, localPort: 0 })
  }
}
