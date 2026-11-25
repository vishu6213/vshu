import { hostMallocTunablesLaunchEnv } from '../../memory/host-malloc-tunables'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'

/** An older slot would leak GLIBC_TUNABLES to user shells, so only this build's own slot gets it. */
export function withOwnBuildLaunchEnv<T extends VshudHostTransport>(
  conn: T,
  ownBuildVersion: () => string | null
): T {
  const vshudLaunchEnv: VshudHostTransport['vshudLaunchEnv'] = async (launch) => [
    ...((await conn.vshudLaunchEnv?.(launch)) ?? []),
    ...(launch.fullVersion === ownBuildVersion() ? hostMallocTunablesLaunchEnv() : [])
  ]
  // Delegate rather than spread so prototype methods survive; #private fields would still need explicit forwarding.
  return Object.create(conn, { vshudLaunchEnv: { value: vshudLaunchEnv } })
}
