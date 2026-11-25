import { vshuSessionAddressSql } from '../vshu-session-address-sql'
import type { VshuSessionId } from '../../../../../shared/agent-session/identity/vshu-session-address'
import type { RunRow } from '../orchestration-records'

type RunCoordinatorVshuSessionFields = Pick<
  RunRow,
  'coordinator_vshu_session_id' | 'coordinator_vshu_session_id_generation' | 'consumer_generation'
>

/** Count a coordinator session id only at its stamped consumer generation; older writers bump generation without clearing it. */
export function currentRunCoordinatorVshuSessionId(
  run: RunCoordinatorVshuSessionFields
): VshuSessionId | null {
  return run.coordinator_vshu_session_id_generation === run.consumer_generation
    ? run.coordinator_vshu_session_id
    : null
}

/** The same rule in SQL, for a `runs` row named `row` (a table name, alias, or `NEW`). */
export function currentRunCoordinatorVshuSessionIdSql(row: string): string {
  return `(CASE WHEN ${row}.coordinator_vshu_session_id_generation = ${row}.consumer_generation
    THEN ${row}.coordinator_vshu_session_id END)`
}

/** The coordinator's `vshu_session_id:<id>` address in SQL; NULL when it has no current Vshu session id. */
export function currentRunCoordinatorSessionAddressSql(row: string): string {
  return vshuSessionAddressSql(currentRunCoordinatorVshuSessionIdSql(row))
}
