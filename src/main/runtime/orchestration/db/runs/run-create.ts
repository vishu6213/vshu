import type { RunRow } from '../orchestration-records'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type { VshuSessionId } from '../../../../../shared/agent-session/identity/vshu-session-address'
import { mailboxAddressOf } from '../../addressing/orchestration-caller-identity'

type RunCoordinatorParams = {
  objective: string
  coordinatorHandle: string | null
  coordinatorPaneKey: string | null
  /** The coordinator's bare Vshu session id when it is a structured session; see vshu-session-address. */
  coordinatorVshuSessionId?: VshuSessionId | null
}

export function createRun(this: OrchestrationDb, params: RunCoordinatorParams): RunRow {
  const id = generateId('run')
  this.db.exec('BEGIN IMMEDIATE')
  try {
    this.insertRunRow(id, params)
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
  return this.getRun(id) as RunRow
}

/** Writes a Run bound to its coordinator inside the caller's transaction. */
export function insertRunRow(
  this: OrchestrationDb,
  id: string,
  params: RunCoordinatorParams
): void {
  const coordinator = {
    terminalHandle: params.coordinatorHandle,
    paneKey: params.coordinatorPaneKey,
    vshuSessionId: params.coordinatorVshuSessionId ?? null
  }
  this.db
    .prepare(
      `INSERT INTO runs (
         id, objective, coordinator_handle, coordinator_pane_key, coordinator_vshu_session_id,
         coordinator_vshu_session_id_generation, consumer_generation, legacy
       ) VALUES (?, ?, ?, ?, ?, 1, 1, 0)`
    )
    .run(
      id,
      params.objective,
      coordinator.terminalHandle,
      coordinator.paneKey,
      coordinator.vshuSessionId
    )
  const address = mailboxAddressOf(coordinator)
  if (address !== null) {
    this.rememberRunCoordinatorHandle(id, address)
  }
}

export type RunCreateMethods = {
  createRun: typeof createRun
  insertRunRow: typeof insertRunRow
}

export function attachRunCreate(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createRun,
    insertRunRow
  })
}
