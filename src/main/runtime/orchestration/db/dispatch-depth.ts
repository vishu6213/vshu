import { createDispatchCreatorEvaluation } from './dispatch-creator-evaluation'
import { requireOrchestrationAdmission } from '../addressing/orchestration-admission'

import type { OrchestrationDb } from './orchestration-db'
import type { VshuSessionId } from '../../../../shared/agent-session/identity/vshu-session-address'
import type { DispatchContextRow, RemoteDispatchAttachmentRow } from './orchestration-records'
import { potentiallyLiveRemoteAttachmentSql } from './federation/remote-attachment-liveness'
import {
  DISPATCH_CONTEXT_COLUMN_LIST,
  REMOTE_DISPATCH_ATTACHMENT_COLUMN_LIST
} from './row-column-lists'

export type DispatchCreatorTurnSource = NonNullable<DispatchContextRow['creator_turn_source']>

/** The system root is internal host-local coordinator code; never let callers select it to bypass depth. */
export type DispatchCreator =
  | { kind: 'system' }
  | {
      kind: 'terminal'
      handle: string
      paneKey?: string
      /** Remote attachment matching requires the exact incarnation; local rows do not. */
      processIncarnation?: string
      /** A structured worker's bare Vshu session id, recorded beside its handle. */
      vshuSessionId?: VshuSessionId | null
      turnSource?: DispatchCreatorTurnSource
    }
  /** A structured session with no terminal handle, identified by its Vshu session id alone. */
  | { kind: 'session'; vshuSessionId: VshuSessionId; turnSource?: DispatchCreatorTurnSource }

/** Creator identity to persist on a new row, so depth can later tell delegation from bookkeeping. */
export function recordedCreatorIdentity(creator: DispatchCreator): {
  creatorHandle: string | null
  creatorPaneKey: string | null
  creatorVshuSessionId: VshuSessionId | null
  creatorTurnSource: DispatchCreatorTurnSource | null
} {
  if (creator.kind === 'system') {
    return {
      creatorHandle: null,
      creatorPaneKey: null,
      creatorVshuSessionId: null,
      creatorTurnSource: null
    }
  }
  const creatorTurnSource = creator.turnSource ?? null
  if (creator.kind === 'session') {
    return {
      creatorHandle: null,
      creatorPaneKey: null,
      creatorVshuSessionId: creator.vshuSessionId,
      creatorTurnSource
    }
  }
  return {
    creatorHandle: creator.handle,
    creatorPaneKey: creator.paneKey ?? null,
    creatorVshuSessionId: creator.vshuSessionId ?? null,
    creatorTurnSource
  }
}

/** The live Dispatch this creator is itself working on, found the way its identity is recorded. */
function findActiveDispatchForCreator(
  this: OrchestrationDb,
  creator: Exclude<DispatchCreator, { kind: 'system' }>
): DispatchContextRow | undefined {
  if (creator.kind === 'terminal') {
    return this.findActiveDispatchForAssignee(creator.handle, creator.paneKey)
  }
  const row = this.db
    .prepare(
      `SELECT ${DISPATCH_CONTEXT_COLUMN_LIST} FROM dispatch_contexts
       WHERE assignee_vshu_session_id = ? AND status IN ('pending', 'dispatched')
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(creator.vshuSessionId)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The schema-pinned complete Dispatch projection returns one Dispatch row or undefined; the adapter exposes unknown.
  return row as DispatchContextRow | undefined
}

/** Match pane and exact incarnation; stored remote handles can lag a remint. */
function findPotentiallyLiveAttachmentsForCreator(
  this: OrchestrationDb,
  creator: Extract<DispatchCreator, { kind: 'terminal' }>
): RemoteDispatchAttachmentRow[] {
  if (!creator.paneKey || !creator.processIncarnation) {
    return []
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The schema-pinned attachment projection returns RemoteDispatchAttachmentRow rows; the adapter exposes unknown.
  const rows = this.db
    .prepare(
      `SELECT ${REMOTE_DISPATCH_ATTACHMENT_COLUMN_LIST} FROM remote_dispatch_attachments
       WHERE process_incarnation = ?
         AND pane_key IS NOT NULL
         AND ${potentiallyLiveRemoteAttachmentSql()}`
    )
    .all(creator.processIncarnation) as RemoteDispatchAttachmentRow[]

  return rows
}

/** Whether the creator's own live Dispatch starts its workers as chats: the row depth reads, one indexed lookup. */
export function creatorStartsChatWorkers(this: OrchestrationDb, creator: DispatchCreator): boolean {
  return (
    creator.kind !== 'system' &&
    findActiveDispatchForCreator.call(this, creator)?.chat_lineage === 1
  )
}

export function resolveCreatorDepth(this: OrchestrationDb, creator: DispatchCreator): number {
  return (
    requireOrchestrationAdmission(
      liveDispatchCreatorEvaluation(this, creator).childDepth(Infinity)
    ) - 1
  )
}
export function resolveCreatorDispatchId(
  this: OrchestrationDb,
  creator: DispatchCreator
): string | null {
  return requireOrchestrationAdmission(liveDispatchCreatorEvaluation(this, creator).creatorId())
}
export function resolveChildDispatchDepth(
  this: OrchestrationDb,
  creator: DispatchCreator,
  maxDepth: number
): number {
  return requireOrchestrationAdmission(
    liveDispatchCreatorEvaluation(this, creator).childDepth(maxDepth)
  )
}
export function liveDispatchCreatorEvaluation(db: OrchestrationDb, creator: DispatchCreator) {
  return createDispatchCreatorEvaluation(creator, {
    local: () =>
      creator.kind === 'system' ? undefined : findActiveDispatchForCreator.call(db, creator),
    remote: () =>
      creator.kind === 'terminal' ? findPotentiallyLiveAttachmentsForCreator.call(db, creator) : []
  })
}

export type DispatchDepthMethods = {
  creatorStartsChatWorkers: typeof creatorStartsChatWorkers
  resolveCreatorDepth: typeof resolveCreatorDepth
  resolveCreatorDispatchId: typeof resolveCreatorDispatchId
  resolveChildDispatchDepth: typeof resolveChildDispatchDepth
}

export function attachDispatchDepth(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    creatorStartsChatWorkers,
    resolveCreatorDepth,
    resolveCreatorDispatchId,
    resolveChildDispatchDepth
  })
}
