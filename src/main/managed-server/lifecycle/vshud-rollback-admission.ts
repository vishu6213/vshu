import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { VshudRollbackResult } from '../install/vshud-remote-rollback'

export function rollbackRecountRefusal(census: VshudTerminalCensus): VshudRollbackResult | null {
  const live = census.liveSessions
  if (live === 0) {
    return null
  }
  return {
    outcome: 'refused',
    code: live === null ? 'vshud_rollback_census_unavailable' : 'vshud_rollback_terminals_running',
    reason:
      live === null
        ? 'The server did not answer how many terminals it runs. Retry when it answers.'
        : 'A terminal opened on this server before it could be stopped; close it, then retry.'
  }
}

export const ROLLBACK_STALE_COUNT: VshudRollbackResult = {
  outcome: 'refused',
  code: 'vshud_rollback_census_unavailable',
  reason: 'The terminal count went stale before the server could be stopped. Retry the rollback.'
}
