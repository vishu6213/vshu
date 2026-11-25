export type VshudTunnelTransport = 'tcp_forward' | 'stdio_bridge'

const transports = new Map<string, VshudTunnelTransport>()

export function rememberVshudTunnelTransport(
  targetId: string,
  transport: VshudTunnelTransport
): void {
  transports.set(targetId, transport)
}

export function knownVshudTunnelTransport(targetId: string): VshudTunnelTransport | null {
  return transports.get(targetId) ?? null
}
