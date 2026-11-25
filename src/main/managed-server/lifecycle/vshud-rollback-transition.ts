import { vshudRemoteBaseDir } from '../install/vshud-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { VshudRollbackOptions, VshudRollbackResult } from '../install/vshud-remote-rollback'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withRolledBackVersion } from '../activation/vshud-activation-record'
import { writeVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { launchAndJudgeVshudSlot } from '../activation/vshud-candidate-launch-verdict'
import { assessVshudRollback } from './vshud-rollback-safety'
import { VSHUD_LOG_FILENAME } from '../install/vshud-remote-host-support'
import {
  captureVshudStateSnapshotCommand,
  vshudRollbackRescueDirName,
  parseVshudSnapshotCapture,
  parseVshudSnapshotPresence,
  parseVshudSnapshotRestore,
  probeVshudStateSnapshotCommand,
  restoreVshudStateSnapshotCommand
} from '../host-state/vshud-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/vshud-state-newest-mtime'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import type { VshudActivationLockControl } from '../activation/vshud-activation-lock'
import {
  rollbackStartingState,
  type VshudRollbackTransaction
} from '../activation/vshud-activation-transaction'
import {
  createVshudRollbackTransaction,
  withVshudRollbackPhase,
  withVshudRollbackRescue
} from '../activation/vshud-activation-transaction-transitions'
import { writeVshudActivationTransaction } from '../activation/vshud-activation-transaction-store'
import { ROLLBACK_STALE_COUNT, rollbackRecountRefusal } from './vshud-rollback-admission'
import { runFencedStop } from '../activation/vshud-fenced-stop'
import { execVshudRemoteOr, withoutAbortSignal } from '../install/vshud-remote-runtime-control'
import { execVshudStateMutationOr } from '../host-state/vshud-state-mutation-exec'
import {
  vshudSlotDir,
  resolveVshudSlotIdentity,
  type VshudSlotIdentity
} from '../activation/vshud-recovery-slot'
import { vshudSnapshotPath } from '../activation/vshud-incumbent-recovery'
import {
  putTransactionIncumbentBack,
  restoreAfterRejectedCandidate
} from '../activation/vshud-transaction-incumbent'
import {
  readVshudRollbackBarrierTarget,
  rollbackBarrierRefusal,
  stopIncumbentBehindTerminalBarrier
} from './vshud-rollback-terminal-barrier'
import { withVshudLogTail } from '../install/vshud-remote-log-tail'
import { errorMessage } from '../../../shared/errors/error-message'

async function stateWritesSinceActivation(options: VshudRollbackOptions): Promise<boolean | null> {
  const activatedAtSeconds = Math.floor(Date.parse(options.record.activatedAt ?? '') / 1000)
  if (!Number.isFinite(activatedAtSeconds)) {
    return null
  }
  const newest = parseNewestStateMtimeSeconds(
    await execVshudRemoteOr(
      options,
      newestStateMtimeCommand(
        options.host,
        options.userDataDir,
        vshudRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  return newest === null ? null : newest >= activatedAtSeconds
}

export async function rollbackVshudLocked(
  options: VshudRollbackOptions,
  lock: VshudActivationLockControl
): Promise<VshudRollbackResult> {
  const now = options.now ?? ((): Date => new Date())
  const snapshot = options.record.snapshot
  const presence = snapshot
    ? parseVshudSnapshotPresence(
        await execVshudRemoteOr(
          options,
          probeVshudStateSnapshotCommand(
            options.host,
            vshudSnapshotPath(options, snapshot.dirName),
            vshudRemoteBaseDir(options.host, options.remoteHome)
          )
        )
      )
    : 'absent'
  const safety = assessVshudRollback({
    record: options.record,
    snapshotPresent: presence === 'unverifiable' ? null : presence === 'present',
    census: options.census,
    targetDaemonProtocol: options.targetDaemonProtocol,
    stateWritesSinceActivation: await stateWritesSinceActivation(options)
  })
  if (safety.safety === 'unsafe') {
    return { outcome: 'refused', code: safety.code, reason: safety.reason }
  }
  if (!snapshot || !options.record.active) {
    return {
      outcome: 'refused',
      code: 'vshud_rollback_no_active',
      reason: 'No vshud version is active on this host, so there is nothing to roll back from.'
    }
  }
  let incumbent: VshudSlotIdentity
  try {
    incumbent = await resolveVshudSlotIdentity(options, options.record.active)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      outcome: 'refused',
      code: 'vshud_rollback_active_identity_unverifiable',
      reason: `The active vshud identity could not be verified: ${errorMessage(error)} Nothing was changed.`
    }
  }

  const barrierTarget = await readVshudRollbackBarrierTarget(options, incumbent.version)
  if (barrierTarget.state === 'refused') {
    return { outcome: 'refused', code: barrierTarget.code, reason: barrierTarget.reason }
  }
  const startedAt = now()
  let transaction: VshudRollbackTransaction = createVshudRollbackTransaction({
    transactionId: randomUUID(),
    incumbentVersion: incumbent.version,
    targetVersion: safety.target,
    recordBefore: options.record,
    recordAfter: withRolledBackVersion(options.record, startedAt),
    rescueDirName: vshudRollbackRescueDirName(incumbent.version, startedAt.getTime()),
    now: startedAt
  })
  const fenced = await runFencedStop({
    recountCensus: options.recountCensus,
    releaseIncumbentAdmission: options.releaseIncumbentAdmission,
    now: () => now().getTime(),
    refuse: rollbackRecountRefusal,
    prepare: () => writeVshudActivationTransaction(options, transaction),
    stale: () => ROLLBACK_STALE_COUNT,
    stop: async () => {
      lock.retainOnError()
      // Cancellation after mutation could strand a stopped host; finish or recover instead.
      options = withoutAbortSignal(options)
      // Pre-lock census can go stale; the fenced stop supplies the terminal-safety proof.
      return stopIncumbentBehindTerminalBarrier(
        options,
        transaction.transactionId,
        barrierTarget.context
      )
    },
    // Withdrawn stops leave the incumbent serving and needing admission reopened.
    stopMayHaveBeenSent: (barrier) => barrier.state !== 'withdrawn'
  })
  if ('refused' in fenced) {
    return fenced.refused
  }
  const blocked = rollbackBarrierRefusal(fenced.stopped)
  if (blocked) {
    if (blocked.retainFence) {
      lock.retain()
    }
    const recovered = blocked.restartIncumbent
      ? ` ${await putIncumbentBack(options, lock, transaction, incumbent)}`
      : ''
    return { outcome: blocked.outcome, code: blocked.code, reason: blocked.reason + recovered }
  }
  transaction = withVshudRollbackPhase(transaction, 'incumbent-stopped', now())
  await writeVshudActivationTransaction(options, transaction)

  const rescue = parseVshudSnapshotCapture(
    await execVshudStateMutationOr(
      options,
      captureVshudStateSnapshotCommand(
        options.host,
        options.userDataDir,
        vshudSnapshotPath(options, transaction.rescue.dirName),
        vshudRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (rescue === 'failed') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'vshud_rollback_rescue_snapshot_failed',
      reason:
        'The current state could not be preserved in a rescue snapshot, so the data root was ' +
        `not replaced. ${recovered}`
    }
  }
  transaction = withVshudRollbackRescue(transaction, rescue, now())
  await writeVshudActivationTransaction(options, transaction)

  // Restore before launching: older builds must never load newer state.
  const restored = parseVshudSnapshotRestore(
    await execVshudStateMutationOr(
      options,
      restoreVshudStateSnapshotCommand(
        options.host,
        options.userDataDir,
        vshudSnapshotPath(options, snapshot.dirName),
        vshudRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (restored !== 'restored') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'vshud_rollback_restore_failed',
      reason: `The pre-activation snapshot could not be restored (${restored}). ${recovered}`
    }
  }
  transaction = withVshudRollbackPhase(transaction, 'rollback-state-restored', now())
  await writeVshudActivationTransaction(options, transaction)

  const targetDir = vshudSlotDir(options, safety.target)
  const { verdict, launchError } = await launchAndJudgeVshudSlot(options, {
    remoteInstallDir: targetDir,
    fullVersion: safety.target,
    buildHash: options.targetBuildHash
  })
  if (verdict.decision === 'reject') {
    const reason =
      launchError === undefined
        ? verdict.reason
        : `It failed while starting: ${errorMessage(launchError)}`
    const recovered = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: targetDir,
      launchedVersion: safety.target,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: rescueVerdict(transaction),
      launchedFromState: rollbackStartingState(transaction)
    })
    return {
      outcome: 'failed',
      code: launchError === undefined ? verdict.code : 'vshud_rollback_target_launch_failed',
      reason: await withVshudLogTail(
        options,
        targetDir,
        `The rollback target ${safety.target} did not come up healthy: ${reason} ${recovered} ` +
          `Its stderr is at ${joinRemotePath(options.host, targetDir, VSHUD_LOG_FILENAME)}.`
      )
    }
  }

  // Until target readiness is proven, active must still identify the recoverable incumbent.
  transaction = withVshudRollbackPhase(transaction, 'target-ready', now())
  await writeVshudActivationTransaction(options, transaction)
  await writeVshudActivationRecord(options, transaction.recordAfter)
  return {
    outcome: 'rolled-back',
    target: safety.target,
    discarded: safety.safety === 'lossy' ? safety.discards : [],
    verdict
  }
}

type RestoreState = Parameters<typeof putTransactionIncumbentBack>[2]['restoreState']

function rescueVerdict(transaction: VshudRollbackTransaction): RestoreState {
  return transaction.rescue.state === 'pending' ? null : transaction.rescue
}

async function putIncumbentBack(
  options: VshudRollbackOptions,
  lock: VshudActivationLockControl,
  transaction: VshudRollbackTransaction,
  incumbent: VshudSlotIdentity
): Promise<string> {
  const failure = await putTransactionIncumbentBack(options, lock, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: null,
    incumbent,
    restoreState: rescueVerdict(transaction)
  })
  return failure ?? `vshud ${incumbent.version} was restored and is serving again.`
}
