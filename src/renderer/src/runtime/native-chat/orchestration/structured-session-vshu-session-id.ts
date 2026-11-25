import {
  formatVshuSessionAddress,
  isVshuSessionId
} from '../../../../../shared/agent-session/identity/vshu-session-address'
import type { OrchestrationSessionAddressResult } from '../../../../../shared/orchestration/orchestration-caller-status'
import { callRuntimeRpc } from '../../rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '../../rpc/calls/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/**
 * A chat's Vshu session ID: its `/clear` root's, which the host derives from the session records.
 * Null for an id that is not a Vshu session id.
 */
export async function resolveStructuredSessionVshuSessionId(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<string | null> {
  if (!isVshuSessionId(sessionId)) {
    return null
  }
  try {
    const result = await callRuntimeRpc<OrchestrationSessionAddressResult>(
      target,
      'orchestration.sessionAddress',
      { sessionId }
    )
    return result.vshuSessionId
  } catch (error) {
    // Why: a host that predates the method routes the current session's ID to the same chat.
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return formatVshuSessionAddress(sessionId)
    }
    throw error
  }
}
