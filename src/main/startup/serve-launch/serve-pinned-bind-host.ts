import { WS_BIND_HOST_LOOPBACK } from '../../runtime/rpc/server/runtime-rpc-pairing-types'
import type { ServeOptions } from './serve-options'

/** Undefined keeps the runtime's own choice: all interfaces for serve, loopback until pairing for the desktop. */
export function resolveServePinnedBindHost(input: {
  vshudSidecar: boolean
  serveOptions: Pick<ServeOptions, 'bind'> | null | undefined
}): string | undefined {
  // vshud reaches its browser sidecar only over the Unix socket / named pipe; keep its WS off the network (#31895).
  if (input.vshudSidecar) {
    return WS_BIND_HOST_LOOPBACK
  }
  return input.serveOptions?.bind
}
