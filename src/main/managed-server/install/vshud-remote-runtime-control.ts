import { VSHUD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/remote-runtime/vshud-distribution/vshud-profile-preflight'
import {
  vshudLaunchCommand,
  parseVshudReadinessOutput,
  type VshudLaunchSpec,
  type VshudReadinessParse
} from './vshud-remote-launch'
import {
  hasWindowsVshudLaunchReport,
  readWindowsVshudLaunchReport,
  readWindowsVshudSlotRuntime,
  readWindowsVshudSlotEntry,
  windowsVshudLaunchCommand,
  windowsVshudLaunchRuntimeCommand
} from './vshud-remote-launch-windows'
import {
  VSHUD_READINESS_WAIT_MAX_SECONDS,
  vshudLaunchExitedDuringWait,
  vshudReadinessWaitCommand,
  parseVshudReadinessWaitOutput
} from './vshud-remote-readiness-wait'
import type { VshudHostTransport } from './vshud-host-transport'
import { errorMessage } from '../../../shared/errors/error-message'
import {
  execCommand,
  isSshCommandExitError,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  currentVshudFence,
  isVshudFenceLost,
  VshudFenceLostError,
  posixVshudFenceGuard
} from '../activation/vshud-activation-fence-scope'
import { vshudWindowsHomeOpCommand } from './vshud-remote-windows-node'
import { VSHUD_WINDOWS_FENCE_ARG } from '../host-state/vshud-windows-host-fence-ops'
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'

// Pause even after early host answers to avoid a tight retry loop.
const READINESS_RETRY_PAUSE_MS = 1_000

export type VshudRemoteExecTarget = {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  /** Locates the runtime store for host-record scripts; required on Windows, unused elsewhere. */
  remoteHome?: string
}

/** A held activation fence must still name this run before any host step. */
export async function execVshudRemote(
  target: VshudRemoteExecTarget,
  command: string,
  signal = target.signal
): Promise<string> {
  const fence = currentVshudFence()
  const run = (line: string): Promise<string> =>
    execCommand(target.conn, line, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      signal
    })
  try {
    if (!fence) {
      return await run(command)
    }
    if (!isWindowsRemoteHost(target.host)) {
      return await run(`${posixVshudFenceGuard(fence)} ${command}`)
    }
    // Host ops check ownership internally; other commands need a preceding check.
    if (!command.includes(VSHUD_WINDOWS_FENCE_ARG) && target.remoteHome) {
      await run(vshudWindowsHomeOpCommand(target.host, target.remoteHome, 'fence-check', []))
    }
    return await run(command)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    throw isVshudFenceLost(error) ? new VshudFenceLostError() : error
  }
}

/** Only confirmed failures use fallback; unconfirmed failures and lost fences propagate. */
export function execVshudRemoteOr(
  target: VshudRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execVshudRemote(target, command).catch((error: unknown) => {
    if (isUnconfirmedSshCommandTermination(error) || error instanceof VshudFenceLostError) {
      throw error
    }
    return fallback
  })
}

/** Recovery paths must finish even when the request that started them was cancelled. */
export function withoutAbortSignal<T extends { signal?: AbortSignal }>(
  options: T
): Omit<T, 'signal'> {
  const { signal: _signal, ...rest } = options
  return rest
}

export async function launchVshudAndAwaitReadiness(
  target: VshudRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: VshudLaunchSpec
): Promise<VshudReadinessParse> {
  if (isWindowsRemoteHost(target.host)) {
    const slotAnswer = await execVshudRemote(
      target,
      windowsVshudLaunchRuntimeCommand(target.host, spec.remoteInstallDir)
    )
    const slotRuntime = readWindowsVshudSlotRuntime(slotAnswer)
    const slotEntry = readWindowsVshudSlotEntry(slotAnswer, target.host, spec.remoteInstallDir)
    readWindowsVshudLaunchReport(
      await windowsLaunchReportOutput(
        target,
        windowsVshudLaunchCommand(target.host, spec, slotRuntime, slotEntry)
      )
    )
  } else {
    await execVshudRemote(
      target,
      vshudLaunchCommand(
        target.host,
        spec,
        target.conn.vshudLaunchDetach ?? 'nohup',
        (await target.conn.vshudLaunchEnv?.({ fullVersion: spec.fullVersion })) ?? []
      )
    )
  }
  const deadline = Date.now() + (target.readinessTimeoutMs ?? VSHUD_STARTUP_READINESS_TIMEOUT_MS)
  const sleep = target.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseVshudReadinessOutput('')
  let lastWaitError: unknown
  // Always read once, even if client scheduling outlasted the deadline.
  for (let first = true; first || Date.now() < deadline; first = false) {
    target.signal?.throwIfAborted()
    const waitSeconds = Math.min(
      VSHUD_READINESS_WAIT_MAX_SECONDS,
      Math.ceil((deadline - Date.now()) / 1000)
    )
    let output: string
    try {
      output = await execVshudRemote(
        target,
        vshudReadinessWaitCommand(target.host, spec.remoteInstallDir, waitSeconds)
      )
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        isUnconfirmedSshCommandTermination(error) ||
        error instanceof VshudFenceLostError
      ) {
        throw error
      }
      // Failed reads do not prove launch failure; stopping here could kill a healthy candidate.
      lastWaitError = error
      console.warn(`[vshud] readiness wait failed; retrying: ${errorMessage(error)}`)
      await sleep(READINESS_RETRY_PAUSE_MS)
      continue
    }
    target.signal?.throwIfAborted()
    lastWaitError = undefined
    last = parseVshudReadinessWaitOutput(target.host, output)
    // An exited launch answers as the deadline would, so callers attach the same log tail.
    if (last.state !== 'pending' || vshudLaunchExitedDuringWait(target.host, output)) {
      return last
    }
    await sleep(READINESS_RETRY_PAUSE_MS)
  }
  if (lastWaitError !== undefined) {
    throw lastWaitError
  }
  return last
}

/** The launcher writes its report before exiting nonzero, so a failed launch still names its cause. */
async function windowsLaunchReportOutput(
  target: VshudRemoteExecTarget,
  command: string
): Promise<string> {
  try {
    return await execVshudRemote(target, command)
  } catch (error) {
    // Without a report the command error carries the better diagnostic.
    if (isSshCommandExitError(error) && hasWindowsVshudLaunchReport(error.stdout)) {
      return error.stdout
    }
    throw error
  }
}
