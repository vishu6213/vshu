/** Journal durably before mutation so interrupted deploys can finish or recover. Release the fence only once the host is provably settled on one slot. */
import { vshudRemoteBaseDir } from '../install/vshud-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { VshudDeployOptions, VshudDeployResult } from '../install/vshud-remote-deploy'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withActivatedVersion, type VshudStateSnapshot } from './vshud-activation-record'
import {
  readVshudActivationRecord,
  writeVshudActivationRecord
} from './vshud-activation-record-store'
import { launchAndJudgeVshudSlot } from './vshud-candidate-launch-verdict'
import { recountLostInProcessCount } from './vshud-update-plan'
import {
  asksCandidateForLiveDaemons,
  censusForLockedRecord,
  countedLockedRecord,
  vshudUpdatePlanner,
  type VshudUpdatePlan
} from './vshud-activation-census'
import { runFencedStop } from './vshud-fenced-stop'
import { VSHUD_LOG_FILENAME } from '../install/vshud-remote-host-support'
import { vshudSnapshotFailureReason } from '../host-state/vshud-state-snapshot-space'
import {
  VSHUD_SNAPSHOT_SPACE_INSUFFICIENT_CODE,
  vshudSnapshotRoomRefusal,
  vshudSnapshotsRoot
} from '../host-state/vshud-snapshot-room'
import {
  captureVshudStateSnapshotCommand,
  vshudSnapshotDirName,
  parseVshudSnapshotCapture
} from '../host-state/vshud-state-snapshot'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { computeLocalVshudBuildHash } from '../install/vshud-local-build-hash'
import { preflightVshudCandidate } from './vshud-candidate-preflight'
import type { VshudActivationLockControl } from './vshud-activation-lock'
import type { VshudActivateTransaction } from './vshud-activation-transaction'
import {
  createVshudActivationTransaction,
  withVshudActivationCandidateReady,
  withVshudActivationIncumbentStopped,
  withVshudActivationSnapshot
} from './vshud-activation-transaction-transitions'
import { writeVshudActivationTransaction } from './vshud-activation-transaction-store'
import { execVshudRemoteOr, withoutAbortSignal } from '../install/vshud-remote-runtime-control'
import { execVshudStateMutationOr } from '../host-state/vshud-state-mutation-exec'
import {
  initialVshudActivationAdmissionCommand,
  parseInitialVshudActivationAdmission
} from './vshud-initial-activation-admission'
import {
  vshudSlotDir,
  resolveVshudSlotIdentity,
  type VshudSlotIdentity
} from './vshud-recovery-slot'
import { vshudSnapshotPath } from './vshud-incumbent-recovery'
import {
  restartAfterSnapshotFailure,
  restoreAfterRejectedCandidate,
  stopTransactionIncumbent
} from './vshud-transaction-incumbent'
import { withVshudLogTail } from '../install/vshud-remote-log-tail'
import { vshudCandidateLaunchFailureCode } from '../../vshud/diagnostics/vshud-host-unavailable'
import { errorMessage } from '../../../shared/errors/error-message'

type Outcome = Extract<VshudDeployResult, { outcome: 'installed-not-activated' }>

export const VSHUD_ACTIVATION_POLICY_REFUSED_CODE = 'vshud_activation_policy_refused'

export async function activateInstalledVshud(
  options: VshudDeployOptions & { localVshudDir: string },
  fullVersion: string,
  remoteDir: string,
  lock: VshudActivationLockControl
): Promise<VshudDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const notActivated = (
    code: string,
    reason: string,
    extra: { startCheckFailed?: true; forceable?: true } = {}
  ): Outcome => ({ outcome: 'installed-not-activated', fullVersion, code, reason, ...extra })
  const deferred = (defer: Extract<VshudUpdatePlan, { action: 'defer' }>): Outcome =>
    notActivated(defer.code, defer.reason, defer.forceable ? { forceable: true } : {})
  const record = await readVshudActivationRecord(options)
  const planFor = vshudUpdatePlanner(record, fullVersion, options.force)
  const census = censusForLockedRecord(options, record)
  let plan = planFor(census)
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  const refusal = options.admitRecord?.(record, fullVersion)
  if (refusal) {
    return notActivated(VSHUD_ACTIVATION_POLICY_REFUSED_CODE, refusal)
  }
  const asksCandidate = asksCandidateForLiveDaemons(census, options.force)
  if (
    plan.action === 'defer' &&
    !(asksCandidate && plan.code === 'vshud_update_daemon_protocol_unverifiable')
  ) {
    return deferred(plan)
  }
  const preflight = await preflightVshudCandidate(
    { ...options, remoteInstallDir: remoteDir, fullVersion },
    asksCandidate
  )
  if ('failure' in preflight) {
    return notActivated(preflight.code, preflight.failure, { startCheckFailed: true })
  }
  const { hostDaemonProtocols } = preflight
  plan = planFor(census, hostDaemonProtocols)
  if (plan.action === 'defer') {
    return deferred(plan)
  }

  let incumbent: VshudSlotIdentity | null = null
  if (record.active) {
    try {
      incumbent = await resolveVshudSlotIdentity(options, record.active)
    } catch (error) {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return notActivated(
        'vshud_incumbent_identity_unverifiable',
        `The active vshud ${record.active} build identity could not be verified before ` +
          `stopping it: ${errorMessage(error)} Nothing was stopped.`
      )
    }
  } else {
    const admission = parseInitialVshudActivationAdmission(
      await execVshudRemoteOr(
        options,
        initialVshudActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    if (admission.decision === 'defer') {
      return notActivated(admission.code, admission.reason)
    }
  }

  // Scan snapshot room before recount so slow scans cannot outdate stop admission.
  const roomless = await vshudSnapshotRoomRefusal(options, record, fullVersion)
  if (roomless) {
    return notActivated(VSHUD_SNAPSHOT_SPACE_INSUFFICIENT_CODE, roomless)
  }

  const startedAt = now()
  let transaction: VshudActivateTransaction = createVshudActivationTransaction({
    transactionId: randomUUID(),
    candidateVersion: fullVersion,
    appVersion: options.appVersion,
    recordBefore: record,
    snapshotDirName: vshudSnapshotDirName(fullVersion, startedAt.getTime()),
    now: startedAt
  })
  const beginMutating = (): void => {
    lock.retainOnError()
    // After mutation starts, cancellation would strand a stopped host; finish or roll back.
    options = withoutAbortSignal(options)
  }
  if (incumbent) {
    // Recount immediately before stop; the initial census may predate a long upload.
    const fenced = await runFencedStop({
      recountCensus: () =>
        countedLockedRecord(options, record)
          ? options.recountCensus()
          : Promise.reject(new Error('not the incumbent this update counted')),
      releaseIncumbentAdmission: options.releaseIncumbentAdmission,
      now: () => now().getTime(),
      refuse: (recounted) => {
        const plan =
          recountLostInProcessCount(census, recounted) ?? planFor(recounted, hostDaemonProtocols)
        return plan.action === 'defer' ? deferred(plan) : null
      },
      prepare: () => writeVshudActivationTransaction(options, transaction),
      stale: () =>
        notActivated(
          'vshud_update_terminal_census_unavailable',
          'The terminal count went stale before the current server could be stopped, so nothing ' +
            'was stopped. Vshu will try the update again.'
        ),
      stop: () => {
        beginMutating()
        return stopTransactionIncumbent(options, incumbent, lock)
      },
      stopMayHaveBeenSent: (unstopped) => unstopped === null || unstopped.stopMayBeUnderway
    })
    if ('refused' in fenced) {
      return fenced.refused
    }
    if (fenced.stopped) {
      return notActivated(
        'vshud_outgoing_stop_incomplete',
        `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. Vshu ` +
          'requires matching runtime readiness before signaling an incumbent and confirmed exit ' +
          'before snapshotting.'
      )
    }
  } else {
    await writeVshudActivationTransaction(options, transaction)
    beginMutating()
  }
  transaction = withVshudActivationIncumbentStopped(transaction, now())
  await writeVshudActivationTransaction(options, transaction)

  // Wait for confirmed exit before snapshotting; a live SQLite WAL is not a backup boundary.
  const snapshotDir = vshudSnapshotPath(options, transaction.snapshot.dirName)
  const captureOutput = await execVshudStateMutationOr(
    options,
    captureVshudStateSnapshotCommand(
      options.host,
      options.userDataDir,
      snapshotDir,
      vshudRemoteBaseDir(options.host, options.remoteHome),
      {
        snapshotsRoot: vshudSnapshotsRoot(options),
        keep: [transaction.snapshot.dirName, ...(record.snapshot ? [record.snapshot.dirName] : [])]
      }
    ),
    'FAILED'
  )
  const capture = parseVshudSnapshotCapture(captureOutput)
  if (capture === 'failed') {
    const reason = vshudSnapshotFailureReason(captureOutput)
    const restarted = incumbent
      ? ` The incumbent was stopped before snapshotting; ${await restartAfterSnapshotFailure(options, incumbent, lock)}`
      : ''
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}` +
        `${reason ? `: ${reason}` : ''}. Vshu's persisted state carries no schema version, so ` +
        'without a snapshot a rollback has no way back. Refusing to activate. Fix what stops ' +
        `the copy (often a full disk or quota on ${vshudRemoteBaseDir(options.host, options.remoteHome)}), ` +
        `then reconnect.${restarted}`
    )
  }
  const snapshot: VshudStateSnapshot | null =
    capture === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: fullVersion,
          readableByVersion: record.active,
          takenAt: startedAt.toISOString()
        }
      : null
  transaction = withVshudActivationSnapshot(transaction, capture, now())
  await writeVshudActivationTransaction(options, transaction)

  const { verdict, launchError } = await launchAndJudgeVshudSlot(options, {
    remoteInstallDir: remoteDir,
    fullVersion,
    buildHash: computeLocalVshudBuildHash(options.localVshudDir)
  })
  if (verdict.decision === 'reject') {
    const [code, reason] =
      launchError === undefined
        ? [verdict.code, verdict.reason]
        : [
            vshudCandidateLaunchFailureCode(launchError),
            `The candidate failed while starting: ${errorMessage(launchError)}`
          ]
    const restored = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: vshudSlotDir(options, transaction.candidateVersion),
      launchedVersion: transaction.candidateVersion,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: transaction.snapshot
    })
    const located =
      `${reason} Candidate stderr is at ` +
      `${joinRemotePath(options.host, remoteDir, VSHUD_LOG_FILENAME)}. ${restored}`
    return notActivated(code, await withVshudLogTail(options, remoteDir, located), {
      startCheckFailed: true
    })
  }

  const recordAfter = withActivatedVersion(record, fullVersion, snapshot, now(), options.appVersion)
  transaction = withVshudActivationCandidateReady(transaction, recordAfter, now())
  await writeVshudActivationTransaction(options, transaction)
  await writeVshudActivationRecord(options, recordAfter)
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
