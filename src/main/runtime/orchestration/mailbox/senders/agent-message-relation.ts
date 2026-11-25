import type { AgentMessageSender } from '../../../../../shared/agent-session/journal/agent-session-message-source'
import { readWorkerTerminalHostScope } from '../../../../../shared/orchestration/workers/worker-terminal-host-scope'
import type { OrchestrationDb } from '../../db/orchestration-db'
import type { DispatchContextRow } from '../../db/orchestration-records'
import { canonicalVshuSessionId } from '../../addressing/session-lineage/canonical-vshu-session-id'
import { resolveOrchestrationParty } from '../../addressing/orchestration-party'
import { runCoordinatorKey } from '../../addressing/orchestration-caller-identity'

type Party = Pick<AgentMessageSender['party'], 'terminalHandle' | 'vshuSessionId'>

function sameParty(a: Party, b: Party): boolean {
  if (a.vshuSessionId && b.vshuSessionId) {
    return canonicalVshuSessionId(a.vshuSessionId) === canonicalVshuSessionId(b.vshuSessionId)
  }
  return Boolean(a.terminalHandle && a.terminalHandle === b.terminalHandle)
}

function localDispatch(dispatch: DispatchContextRow): boolean {
  const scope = readWorkerTerminalHostScope(dispatch.host_scope)
  return scope.kind === 'absent' || (scope.kind === 'local' && scope.id === 'local')
}

/** How a sender relates to its recipient, and, for a worker, the Dispatch that proves it. */
export type Lineage = {
  relation: AgentMessageSender['relation']
  workerDispatch?: DispatchContextRow
}

const UNKNOWN: Lineage = { relation: undefined }

// What Vshu mails as a local worker's dispatch that is that worker's result: its failed start, its
// loss, mail it never got. Its questions and setup status are not (they stay where they were asked).
const LOCAL_DISPATCH_RESULTS: ReadonlySet<string> = new Set(['escalation', 'worker_done'])

/** A federated worker mails as its dispatch, and so does Vshu for a local one: 'worker' only when
 *  that dispatch, in the Run, was created by the recipient, and for a local one only its results;
 *  anything else is unknown. */
function dispatchWorkerLineage(
  db: OrchestrationDb,
  dispatchId: string,
  args: Pick<RelationArgs, 'runId' | 'messageType'>,
  recipient: Party
): Lineage {
  const { runId } = args
  const dispatch = db.getDispatchContextById(dispatchId)
  const known =
    dispatch &&
    (db.getFederatedDispatch(dispatchId) ||
      (localDispatch(dispatch) && LOCAL_DISPATCH_RESULTS.has(args.messageType ?? '')))
  const creator = known && dispatch.run_id === runId ? dispatch : null
  return creator &&
    sameParty(
      { terminalHandle: creator.creator_handle, vshuSessionId: creator.creator_vshu_session_id },
      recipient
    )
    ? { relation: 'worker', workerDispatch: creator }
    : UNKNOWN
}

type RelationArgs = {
  db: OrchestrationDb | null
  sender: AgentMessageSender['party']
  recipient: string
  runId: string
  reportedDispatchId?: string
  recipientDispatchId: string | null
  /** The mail's type: a local dispatch's own mail is lineage only for its results. */
  messageType?: string
}

/** Delivery-time evidence only; missing, ambiguous or foreign lineage is unknown. */
export function agentMessageRelation(args: RelationArgs): AgentMessageSender['relation'] {
  return agentMessageLineage(args).relation
}

/** A worker's mail reports to where the turn that started it came from: a turn its coordinator's
 *  connector conversation woke sends it back there; any other stays in Vshu. */
export function reportsToConversation(lineage: Lineage): boolean {
  return (
    lineage.relation === 'worker' && lineage.workerDispatch?.creator_turn_source === 'connector'
  )
}

export function agentMessageLineage(args: RelationArgs): Lineage {
  try {
    const { db, sender, runId } = args
    if (!db || args.recipient.startsWith('dispatch:')) {
      return UNKNOWN
    }
    const run = db.getRun(runId)
    if (!run) {
      return UNKNOWN
    }
    const recipient =
      args.recipient === `run:${runId}`
        ? runCoordinatorKey(run)
        : resolveOrchestrationParty(args.recipient, db)
    if (sender.address.startsWith('dispatch:')) {
      return dispatchWorkerLineage(db, sender.address.slice('dispatch:'.length), args, recipient)
    }
    const coordinator = runCoordinatorKey(run)
    const dispatchFor = (party: Party, id?: string | null) => {
      const candidates = id
        ? [db.getDispatchContextById(id)]
        : db.getActiveDispatchMailboxOwners(
            party.terminalHandle ??
              (party.vshuSessionId ? `vshu_session_id:${party.vshuSessionId}` : '')
          )
      const matches = candidates.filter((row): row is DispatchContextRow =>
        Boolean(
          row &&
          row.run_id === runId &&
          localDispatch(row) &&
          sameParty(party, {
            terminalHandle: row.assignee_handle,
            vshuSessionId: row.assignee_vshu_session_id
          })
        )
      )
      return matches.length === 1 ? matches[0] : undefined
    }
    const parentOf = (dispatch: DispatchContextRow | undefined): Party | undefined => {
      if (!dispatch) {
        return undefined
      }
      if (dispatch.creator_handle || dispatch.creator_vshu_session_id) {
        return {
          terminalHandle: dispatch.creator_handle,
          vshuSessionId: dispatch.creator_vshu_session_id
        }
      }
      if (dispatch.creator_dispatch_id) {
        const creator = db.getDispatchContextById(dispatch.creator_dispatch_id)
        return creator && creator.run_id === runId && localDispatch(creator)
          ? {
              terminalHandle: creator.assignee_handle,
              vshuSessionId: creator.assignee_vshu_session_id
            }
          : undefined
      }
      return undefined
    }
    const senderDispatch = dispatchFor(sender, args.reportedDispatchId)
    const recipientDispatch = dispatchFor(recipient, args.recipientDispatchId)
    const senderParent = parentOf(senderDispatch)
    const recipientParent = parentOf(recipientDispatch)
    if (!sameParty(sender, recipient)) {
      if (senderParent && sameParty(senderParent, recipient)) {
        return { relation: 'worker', ...(senderDispatch ? { workerDispatch: senderDispatch } : {}) }
      }
      if (recipientParent && sameParty(recipientParent, sender)) {
        return { relation: 'coordinator' }
      }
    }
    return (senderParent || sameParty(sender, coordinator)) &&
      (recipientParent || sameParty(recipient, coordinator))
      ? { relation: 'none' }
      : UNKNOWN
  } catch {
    // Lineage is informational; an unavailable database must never block delivery.
    return UNKNOWN
  }
}
