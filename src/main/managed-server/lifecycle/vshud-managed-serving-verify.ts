import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { VshudManagedServing } from './vshud-managed-serving'
import { verifyManagedTunnelServing } from './vshud-managed-tunnel'

/** Return unverifiable on failures rather than throwing. */
export function verifyVshudManagedServing(
  userDataPath: string,
  selector: string
): Promise<VshudManagedServing> {
  return Promise.resolve()
    .then(async () => verifyManagedTunnelServing(await resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
