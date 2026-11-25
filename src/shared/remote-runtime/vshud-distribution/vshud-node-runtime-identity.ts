import { NODE_RUNTIME_PIN } from '../../node-runtime/node-runtime-pin'
import type { VshudPreflightRuntimeIdentity } from './vshud-profile-preflight'

/** What a Node slot's candidate must report: the pinned runtime, never a host Node. */
export const VSHUD_NODE_RUNTIME_IDENTITY: VshudPreflightRuntimeIdentity = {
  runtime: 'node',
  runtimeVersion: NODE_RUNTIME_PIN.version
}
