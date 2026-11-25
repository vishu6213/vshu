/** Which census an activation may plan on, and when it asks the candidate which daemons are alive. */
import type { VshudDeployOptions } from '../install/vshud-remote-deploy'
import type { VshudActivationRecord } from './vshud-activation-record'
import { planVshudUpdate, type VshudUpdateForce } from './vshud-update-plan'
import {
  isAnsweredVshudTerminalCensus,
  type VshudTerminalCensus,
  UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import {
  censusNeedsHostDaemonProtocols,
  CURRENT_VSHUD_DAEMON_PROTOCOL
} from './vshud-daemon-protocol-crossing'

export type VshudUpdatePlan = ReturnType<typeof planVshudUpdate>

export function countedLockedRecord(
  options: Pick<VshudDeployOptions, 'censusRecord'>,
  record: VshudActivationRecord
): boolean {
  const counted = options.censusRecord
  return (
    !counted || (counted.active === record.active && counted.activatedAt === record.activatedAt)
  )
}

/** A census of another incumbent cannot authorize stopping this one. */
export function censusForLockedRecord(
  options: Pick<VshudDeployOptions, 'censusRecord' | 'census'>,
  record: VshudActivationRecord
): VshudTerminalCensus {
  return countedLockedRecord(options, record) ? options.census : UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
}

/** Old hosts cannot name mixed generations, nor a dead daemon count sessions; the candidate can. */
export function asksCandidateForLiveDaemons(
  census: VshudTerminalCensus,
  force: VshudUpdateForce | undefined
): boolean {
  // Only full force probes an uncounted census: a failed probe must not mark a deferred host incompatible.
  return (
    censusNeedsHostDaemonProtocols(census) ||
    (force === true && census.liveSessions === null && isAnsweredVshudTerminalCensus(census))
  )
}

export function vshudUpdatePlanner(
  record: VshudActivationRecord,
  candidateVersion: string,
  force: VshudUpdateForce | undefined
): (census: VshudTerminalCensus, hostDaemonProtocols?: readonly number[]) => VshudUpdatePlan {
  return (census, hostDaemonProtocols) =>
    planVshudUpdate({
      record,
      candidateVersion,
      census,
      candidateDaemonProtocol: CURRENT_VSHUD_DAEMON_PROTOCOL,
      ...(hostDaemonProtocols ? { hostDaemonProtocols } : {}),
      ...(force !== undefined ? { force } : {})
    })
}
