import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testVshuSessionId } from '../../shared/agent-session/identity/vshu-session-address-test-fixture'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import '../runtime/orchestration/db/contract-constants'
import '../runtime/orchestration/db/messages/mailbox-routing-page'
import '../runtime/orchestration/db/dispatch-row-writer'
import '../runtime/orchestration/db/attempt-outcome-projection'
import { botDispatches } from './bot-chat-dispatches'

const CHAT_SESSION = testVshuSessionId('chat-session')

const opened: { db: OrchestrationDb; dir: string }[] = []

afterEach(() => {
  for (const { db, dir } of opened.splice(0)) {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function openDb(): OrchestrationDb {
  const dir = mkdtempSync(join(tmpdir(), 'vshu-bot-chat-dispatches-'))
  const db = new OrchestrationDb(join(dir, 'orchestration.db'))
  opened.push({ db, dir })
  return db
}

/** A Dispatch the bot's chat started, failed as the current writers fail one. */
function failedDispatch(db: OrchestrationDb, spec: string): string {
  const task = db.createTask({ runId: 'run_legacy_local', spec })
  const dispatch = db.createDispatchContext({
    taskId: task.id,
    assigneeHandle: `term_${spec}`,
    creator: { kind: 'session', vshuSessionId: CHAT_SESSION },
    maxDepth: Number.MAX_SAFE_INTEGER
  })
  db.failDispatch(dispatch.id, 'boom')
  return dispatch.id
}

function placed(db: OrchestrationDb) {
  return botDispatches(
    db,
    (sessionId) => (sessionId === CHAT_SESSION ? 'chat' : null),
    () => null,
    { vshuSessionIds: [CHAT_SESSION], paneKeys: [] }
  )
}

describe('botDispatches: settle times', () => {
  it('marks a settled Dispatch with no completion time as undated, still ordered by creation', () => {
    const db = openDb()
    const dated = failedDispatch(db, 'dated')
    const legacy = failedDispatch(db, 'legacy')
    // As the first failure writer left a row: failed, with no completion time.
    db.db.prepare('UPDATE dispatch_contexts SET completed_at = NULL WHERE id = ?').run(legacy)
    const row: unknown = db.db
      .prepare("SELECT strftime('%s', created_at) * 1000 AS ms FROM dispatch_contexts WHERE id = ?")
      .get(legacy)
    const createdMs = typeof row === 'object' && row !== null && 'ms' in row ? row.ms : null
    expect(typeof createdMs).toBe('number')

    const byId = new Map(placed(db).map((dispatch) => [dispatch.id, dispatch]))
    // Still a failure: only its time is uncertain.
    expect(byId.get(legacy)).toMatchObject({
      settled: true,
      failed: true,
      undated: true,
      at: createdMs
    })
    expect(byId.get(dated)?.settled).toBe(true)
    expect(byId.get(dated)?.undated).toBeUndefined()
  })
})
