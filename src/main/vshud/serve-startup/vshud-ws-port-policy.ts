import { VSHUD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-managed-launch-env'
import { DEFAULT_WS_PORT } from '../../runtime/rpc/server/runtime-rpc-pairing-types'
import {
  clearWsFallbackPort,
  readWsFallbackPort,
  wsFallbackPortLadder
} from '../../runtime/rpc/transports/websocket/ws-fallback-port-store'

type VshudWsPortOptions = {
  wsPort?: number
  preferPinnedWsPort?: boolean
  requirePinnedWsPort?: boolean
}

/** First port past the desktop runtime's default and its whole fallback ladder. */
export const MANAGED_VSHUD_PREFERRED_WS_PORT =
  Math.max(...wsFallbackPortLadder(DEFAULT_WS_PORT)) + 1

const isDesktopRuntimePort = (port: number): boolean =>
  port >= DEFAULT_WS_PORT && port < MANAGED_VSHUD_PREFERRED_WS_PORT

/** Honor explicit ports; managed launches permit fallback because WSL distros share loopback. */
export function vshudWsPortOptions(
  port: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): VshudWsPortOptions {
  if (port === undefined) {
    return {}
  }
  if (!env[VSHUD_MANAGED_ACTIVATION_ROOT_ENV]) {
    return { wsPort: port, preferPinnedWsPort: true, requirePinnedWsPort: true }
  }
  // Clients follow a managed server's published port, but desktop pairings and tunnels are pinned to
  // the desktop's ports; an vshud started while the desktop is closed must not keep them (#41799).
  return {
    wsPort: isDesktopRuntimePort(port) ? MANAGED_VSHUD_PREFERRED_WS_PORT : port,
    preferPinnedWsPort: true
  }
}

/** Older managed vshuds saved desktop ports as their fallback; drop one so a busy preferred port cannot pull vshud back. */
export function clearDesktopRuntimeFallbackPort(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  const saved = readWsFallbackPort(userDataPath)
  if (
    env[VSHUD_MANAGED_ACTIVATION_ROOT_ENV] &&
    saved !== undefined &&
    isDesktopRuntimePort(saved)
  ) {
    clearWsFallbackPort(userDataPath)
  }
}
