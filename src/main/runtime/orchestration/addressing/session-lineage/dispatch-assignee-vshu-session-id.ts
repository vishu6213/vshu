import {
  parseVshuSessionAddress,
  type VshuSessionId
} from '../../../../../shared/agent-session/identity/vshu-session-address'
import { structuredWorkerVshuSessionIdForIncarnation } from '../../terminal-authority/structured-sessions/structured-worker-identity'
import { canonicalVshuSessionId } from './canonical-vshu-session-id'

/** Resolve structured incarnations or chat addresses to bare session ids; PTYs have none. */
export function dispatchAssigneeVshuSessionId(assignee: {
  handle: string
  processIncarnation: string | null | undefined
}): VshuSessionId | null {
  const vshuSessionId =
    structuredWorkerVshuSessionIdForIncarnation(assignee.processIncarnation) ??
    parseVshuSessionAddress(assignee.handle)
  return vshuSessionId === null ? null : canonicalVshuSessionId(vshuSessionId)
}
