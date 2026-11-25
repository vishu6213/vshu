// Readiness and instance-lock records must agree before the slot's own build requests a stop.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { selectVshudSlotRuntimeCommand } from '../install/vshud-remote-runtime'
import {
  parseVshudReadinessWaitOutput,
  readVshudReadinessNowCommand
} from '../install/vshud-remote-readiness-wait'
import { execVshudRemote } from '../install/vshud-remote-runtime-control'
import { readBoundedVshudRemoteRecord } from '../install/vshud-remote-record-file'
import { vshudSlotDir, type VshudSlotOptions } from '../activation/vshud-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  vshudWindowsNodeCommandLine,
  vshudWindowsSlotOpCommand,
  readVshudWindowsEncodedAnswer
} from '../install/vshud-remote-windows-node'
import { VSHUD_WINDOWS_RUNTIME_MARKER } from '../host-state/vshud-windows-host-script'
import { VSHUD_LOCK_FILE_NAME } from '../../vshud/instance-lock/vshud-instance-lock'
import { parseVshudInstanceLockRecord } from '../../vshud/instance-lock/vshud-instance-lock-record'
import {
  VSHUD_CANCEL_MANAGED_STOP_FLAG,
  VSHUD_COMPLETE_MANAGED_STOP_FLAG,
  VSHUD_MANAGED_STOP_REQUEST_FILE_FLAG,
  VSHUD_STOP_REQUESTS_CAPABILITY,
  VshudManagedStopCancellationSchema,
  VshudManagedStopCompletionSchema,
  type VshudManagedStopCancellation,
  type VshudManagedStopCompletion,
  type VshudManagedStopContext,
  type VshudManagedStopRequest
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'

const LOCK_RECORD_MAX_BYTES = 64 * 1024

export type VshudManagedStopTarget =
  | { state: 'ready'; context: VshudManagedStopContext }
  | { state: 'refused'; verdict: 'unverifiable'; code: string; reason: string }

function refused(code: string, reason: string): VshudManagedStopTarget {
  return { state: 'refused', verdict: 'unverifiable', code, reason }
}

export async function readRemoteVshudManagedStopTarget(
  options: VshudSlotOptions,
  version: string
): Promise<VshudManagedStopTarget> {
  const slotDir = vshudSlotDir(options, version)
  const readiness = parseVshudReadinessWaitOutput(
    options.host,
    await execVshudRemote(options, readVshudReadinessNowCommand(options.host, slotDir))
  )
  if (readiness.state !== 'ready' || !readiness.readiness.health) {
    return refused(
      'vshud_managed_stop_readiness_unverifiable',
      `vshud ${version} has no readable readiness record, so the running instance is unknown.`
    )
  }
  const { health, runtimeId } = readiness.readiness
  if (health.stopRequests !== VSHUD_STOP_REQUESTS_CAPABILITY) {
    return refused(
      'vshud_managed_stop_unsupported',
      `vshud ${version} predates managed stop requests; it can only be stopped by signal.`
    )
  }
  const lockPath = joinRemotePath(options.host, options.userDataDir, VSHUD_LOCK_FILE_NAME)
  const lockRead = await readBoundedVshudRemoteRecord(options, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = lockRead.state === 'present' ? parseVshudInstanceLockRecord(lockRead.raw) : null
  if (!lock || lock.pid !== health.pid || !runtimeId) {
    return refused(
      'vshud_managed_stop_instance_unverifiable',
      `The instance lock does not name the vshud ${version} that published readiness.`
    )
  }
  return {
    state: 'ready',
    context: {
      version,
      runtimeId,
      instance: {
        pid: lock.pid,
        startedAtMs: lock.startedAtMs,
        // Newer slots use boot/start ticks to avoid wall-clock drift; older readers drop them.
        ...(lock.linuxStartTicks && lock.bootId
          ? { linuxStartTicks: lock.linuxStartTicks, bootId: lock.bootId }
          : {}),
        nonce: lock.nonce,
        lockPath
      }
    }
  }
}

export async function completeRemoteVshudManagedStop(
  options: VshudSlotOptions,
  request: VshudManagedStopRequest
): Promise<VshudManagedStopCompletion> {
  return VshudManagedStopCompletionSchema.parse(
    await runSlotCommand(options, request, VSHUD_COMPLETE_MANAGED_STOP_FLAG)
  )
}

export async function cancelRemoteVshudManagedStop(
  options: VshudSlotOptions,
  request: VshudManagedStopRequest
): Promise<VshudManagedStopCancellation> {
  return VshudManagedStopCancellationSchema.parse(
    await runSlotCommand(options, request, VSHUD_CANCEL_MANAGED_STOP_FLAG)
  )
}

// The slot's own build owns its stop-request format.
async function runSlotCommand(
  options: VshudSlotOptions,
  request: VshudManagedStopRequest,
  flag: string
): Promise<unknown> {
  const slotDir = vshudSlotDir(options, request.version)
  const entry = joinRemotePath(options.host, slotDir, 'vshud.js')
  const output = isWindowsRemoteHost(options.host)
    ? await runWindowsSlotCommand(options, slotDir, entry, request, flag)
    : await execVshudRemote(
        options,
        `${selectVshudSlotRuntimeCommand(options.host, slotDir, options.nodePath)} && ` +
          `"$vshud_runtime" ${quotePosixShell(entry)} ${flag} ${quotePosixShell(JSON.stringify(request))}`
      )
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    throw new Error('vshud managed stop command returned no verifiable answer')
  }
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('vshud managed stop command returned no verifiable answer')
  }
  if (!('transactionId' in parsed) || parsed.transactionId !== request.transactionId) {
    throw new Error('vshud managed stop command answered another transaction')
  }
  return parsed
}

// Stage JSON on Windows to avoid two command-line quoting layers.
async function runWindowsSlotCommand(
  options: VshudSlotOptions,
  slotDir: string,
  entry: string,
  request: VshudManagedStopRequest,
  flag: string
): Promise<string> {
  const runtime = readVshudWindowsEncodedAnswer(
    await execVshudRemote(
      options,
      vshudWindowsSlotOpCommand(options.host, slotDir, 'slot-runtime', [slotDir])
    ),
    VSHUD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this vshud slot needs.')
  }
  const staged = joinRemotePath(options.host, slotDir, `.vshud-stop-command-${randomUUID()}.json`)
  let removeStaged = true
  try {
    await options.conn.writeFile(staged, JSON.stringify(request), {
      hostPlatform: options.host,
      signal: options.signal
    })
    return await execVshudRemote(
      options,
      vshudWindowsNodeCommandLine(runtime, [
        entry,
        flag,
        VSHUD_MANAGED_STOP_REQUEST_FILE_FLAG,
        staged
      ])
    )
  } catch (error) {
    // Unconfirmed commands may still be reading the staged request.
    removeStaged = !isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (removeStaged) {
      await execVshudRemote(
        options,
        vshudWindowsSlotOpCommand(options.host, slotDir, 'remove-file', [staged])
      ).catch(() => {})
    }
  }
}
