import type { NodeRuntimeTarget } from '../../../shared/node-runtime/node-runtime-pin'
import { resolveVshudDeploymentTargetFacts } from '../install/vshud-deployment-target'
import { VshudHostUnsupportedError } from '../../vshud/diagnostics/vshud-host-unavailable'
import type { VshudHostTransport } from '../install/vshud-host-transport'
import { pinnedRuntimeTargetForHost } from '../install/pinned-runtime-host-target'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

/** Lets a caller that knows the host kind add its own fix; the message is the one SSH shows. */
export class VshudHostGlibcUnsupportedError extends VshudHostUnsupportedError {
  constructor(target: string, glibc: string) {
    super(`No Vshu runtime supports ${target} with glibc ${glibc}.`)
  }
}

export async function resolveVshudRuntimeTarget(options: {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<NodeRuntimeTarget> {
  const facts = await resolveVshudDeploymentTargetFacts(options)
  const target = pinnedRuntimeTargetForHost(facts)
  if (!target) {
    const glibc = facts.glibc ? `${facts.glibc.major}.${facts.glibc.minor}` : 'unknown'
    throw new VshudHostGlibcUnsupportedError(facts.target, glibc)
  }
  return target
}
