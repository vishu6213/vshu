// Rollback restores a pre-activation snapshot: older builds may not understand newer state.
// Stop, rescue, restore, then launch; the rescue and fenced journal allow recovery of interrupted steps.
import { logVshudActivationOutcome } from '../activation/vshud-activation-outcome-log'
import type { VshudHostTransport } from './vshud-host-transport'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'
import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { VshudActivationVerdict } from '../activation/vshud-activation-gate'
import type { VshudDaemonProtocolFacts } from '../activation/vshud-daemon-protocol-crossing'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { sameVshudActivationRecord } from '../activation/vshud-activation-transaction'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import {
  resolveVshudActivationReadinessTimeout,
  withVshudActivationLock
} from '../activation/vshud-activation-lock'
import { vshudActivationFenceRefusal } from '../activation/vshud-activation-fence-hold'
import { VSHUD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/remote-runtime/vshud-distribution/vshud-profile-preflight'
import { rollbackVshudLocked } from '../lifecycle/vshud-rollback-transition'

export type VshudRollbackOptions = {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  record: VshudActivationRecord
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  census: VshudTerminalCensus
  /** Close terminal admission, then recount under the host lock; any failure is unverifiable. */
  recountCensus: () => Promise<VshudTerminalCensus>
  /** Reopen admission if rollback leaves the incumbent serving. */
  releaseIncumbentAdmission: () => Promise<void>
  /** Expected hash from the client's copy of the rollback target. */
  targetBuildHash: string
  /** Protocol facts from the same target bytes. */
  targetDaemonProtocol: VshudDaemonProtocolFacts
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type VshudRollbackResult =
  | { outcome: 'rolled-back'; target: string; discarded: string[]; verdict: VshudActivationVerdict }
  | { outcome: 'refused'; code: string; reason: string }
  | { outcome: 'failed'; code: string; reason: string }

export async function rollbackVshud(input: VshudRollbackOptions): Promise<VshudRollbackResult> {
  const options = {
    ...input,
    readinessTimeoutMs: resolveVshudActivationReadinessTimeout(
      input.readinessTimeoutMs,
      VSHUD_STARTUP_READINESS_TIMEOUT_MS
    )
  }
  return logVshudActivationOutcome(
    `rollback to ${options.record.previous ?? 'none'}`,
    () =>
      withVshudActivationLock(
        options,
        async (lock) => {
          if (
            !sameVshudActivationRecord(await readVshudActivationRecord(options), options.record)
          ) {
            return {
              outcome: 'refused',
              code: 'vshud_rollback_record_changed',
              reason:
                'The host activation record changed while this rollback was waiting. Refresh the ' +
                'host state and review the new rollback target before trying again.'
            }
          }
          return rollbackVshudLocked(options, lock)
        },
        async () => {
          const { code, reason } = await vshudActivationFenceRefusal(options, 'rollback')
          return { outcome: 'refused', code, reason }
        }
      ),
    ['rolled-back']
  )
}
