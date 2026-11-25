import { afterEach, describe, expect, it } from 'vitest'
import { testVshuSessionId } from '../../../../../shared/agent-session/identity/vshu-session-address-test-fixture'
import { OrchestrationDb } from '../orchestration-db'
import { dispatchReportMailbox } from '../../workers/reports/dispatch-report-mailbox'
import { currentRunCoordinatorVshuSessionId } from './run-coordinator-vshu-session'
import { handOverCoordinatorChatRuns } from './run-coordinator-handover'

const CLOSED = testVshuSessionId('7b0c4c55-1f7e-4c55-9d43-1b1a8c3c0a01')
const HOME = testVshuSessionId('7b0c4c55-1f7e-4c55-9d43-1b1a8c3c0a02')
const party = (vshuSessionId: typeof HOME) => ({
  vshuSessionId,
  paneKey: null,
  terminalHandle: null
})

let db: OrchestrationDb
afterEach(() => db.close())

describe('handing a closed chat’s Runs over', () => {
  it('sends its workers’ reports, already pointed or still to come, to the chat that reads now', () => {
    db = new OrchestrationDb(':memory:')
    const own = db.createRun({
      objective: 'home work',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorVshuSessionId: HOME
    })
    const room = db.createRun({
      objective: 'room work',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorVshuSessionId: CLOSED
    })
    const task = db.createTask({ runId: room.id, spec: 'work' })
    const dispatch = db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: 'term_worker',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    // A report the closed chat was pointed at but never read.
    const pointed = db.insertMessage({
      runId: room.id,
      from: 'term_worker',
      to: dispatchReportMailbox(db, dispatch),
      subject: 'done',
      type: 'worker_done'
    })
    db.db.prepare("UPDATE messages SET delivered_at = datetime('now') WHERE id = ?").run(pointed.id)

    expect(handOverCoordinatorChatRuns(db, CLOSED, HOME)).toBe(true)

    expect(db.runsBoundToCoordinator(party(CLOSED))).toEqual([])
    expect(
      db
        .runsBoundToCoordinator(party(HOME))
        .map((run) => run.id)
        .toSorted()
    ).toEqual([own.id, room.id].toSorted())
    expect(currentRunCoordinatorVshuSessionId(db.getRun(room.id)!)).toBe(HOME)
    expect(dispatchReportMailbox(db, dispatch)).toBe(`run:${room.id}`)
    expect(db.getMessageById(pointed.id)).toMatchObject({ read: 0, delivered_at: null })
    expect(handOverCoordinatorChatRuns(db, CLOSED, HOME)).toBe(false)
  })
})
