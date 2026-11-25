// Win32-OpenSSH kills session jobs; require native breakaway without WMI/PowerShell, then record PID plus creation time.
import {
  VSHUD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_ENV_FLAG,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
  WINDOWS_BREAKAWAY_STDERR_FLAG,
  WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
  WINDOWS_BREAKAWAY_STDOUT_FLAG
} from '../../../shared/remote-runtime/vshud-lifecycle/windows-breakaway-launch'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import {
  vshudWindowsNodeCommandLine,
  vshudWindowsSlotOpCommand,
  readVshudWindowsEncodedAnswer
} from './vshud-remote-windows-node'
import {
  VSHUD_WINDOWS_ENTRY_MARKER,
  VSHUD_WINDOWS_RUNTIME_MARKER
} from '../host-state/vshud-windows-host-script'
import {
  VSHUD_LOG_FILENAME,
  VSHUD_READINESS_FILENAME,
  VSHUD_WINDOWS_PROCESS_FILENAME
} from './vshud-remote-host-support'
import { vshudManagedLaunchEnv, type VshudLaunchSpec } from './vshud-remote-launch'
import { VSHUD_WINDOWS_LAUNCH_REFUSED_CODE } from '../../vshud/diagnostics/vshud-host-unavailable'

export class VshudWindowsLaunchRefusedError extends Error {
  readonly code = VSHUD_WINDOWS_LAUNCH_REFUSED_CODE
  constructor(reason: string) {
    super(
      `The Windows host refused to start vshud outside the SSH session (${reason}). vshud needs ` +
        'a job that allows breakaway and a slot with the process-tree launcher; it never falls ' +
        'back to WMI.'
    )
    this.name = 'VshudWindowsLaunchRefusedError'
  }
}

/** The launcher reported that it could not start vshud. */
export class VshudWindowsLaunchFailedError extends Error {
  constructor(detail: string) {
    super(`vshud's Windows launcher did not start the candidate: ${detail}.`)
    this.name = 'VshudWindowsLaunchFailedError'
  }
}

/** Resolve pinned slot runtime and remove stale instance-stop intent before launch. */
export function windowsVshudLaunchRuntimeCommand(
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return vshudWindowsSlotOpCommand(host, slotDir, 'slot-runtime', [slotDir, 'clear-stop-request'])
}

export function readWindowsVshudSlotRuntime(output: string): string {
  const runtime = readVshudWindowsEncodedAnswer(output, VSHUD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this vshud slot needs.')
  }
  return runtime
}

/** Older host scripts omit entry, implying the legacy single-file launcher. */
export function readWindowsVshudSlotEntry(
  output: string,
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return (
    readVshudWindowsEncodedAnswer(output, VSHUD_WINDOWS_ENTRY_MARKER) ??
    joinRemotePath(host, slotDir, 'vshud.js')
  )
}

export function windowsVshudLaunchCommand(
  host: RemoteHostPlatform,
  spec: VshudLaunchSpec,
  slotRuntime: string,
  slotEntry = joinRemotePath(host, spec.remoteInstallDir, 'vshud.js')
): string {
  const dir = spec.remoteInstallDir
  return vshudWindowsNodeCommandLine(slotRuntime, [
    slotEntry,
    WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    // CREATE_ALWAYS removes stale readiness before the launcher returns.
    WINDOWS_BREAKAWAY_STDOUT_FLAG,
    joinRemotePath(host, dir, VSHUD_READINESS_FILENAME),
    WINDOWS_BREAKAWAY_STDERR_FLAG,
    joinRemotePath(host, dir, VSHUD_LOG_FILENAME),
    // Preserve previous stderr for crash diagnosis across restart.
    WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
    WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
    joinRemotePath(host, dir, VSHUD_WINDOWS_PROCESS_FILENAME),
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `VSHU_VERSION=${spec.fullVersion}`,
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `VSHU_USER_DATA=${spec.userDataDir}`,
    ...vshudManagedLaunchEnv(spec).flatMap(([name, value]) => [
      WINDOWS_BREAKAWAY_ENV_FLAG,
      `${name}=${value}`
    ]),
    VSHUD_WINDOWS_BREAKAWAY_CONTRACT.argsFlag,
    '--json',
    '--bind',
    spec.bindHost,
    '--port',
    String(spec.port)
  ])
}

export function hasWindowsVshudLaunchReport(output: string): boolean {
  return parseWindowsBreakawayLaunchReport(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, output) !== null
}

/** Return launched PID or surface native-breakaway refusal/failure. */
export function readWindowsVshudLaunchReport(output: string): number {
  const report = parseWindowsBreakawayLaunchReport(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, output)
  if (report?.method === 'breakaway') {
    return report.pid
  }
  if (report?.method === 'unavailable') {
    throw new VshudWindowsLaunchRefusedError(
      report.step ? `${report.reason} at ${report.step}` : report.reason
    )
  }
  if (report?.method === 'failed') {
    throw new VshudWindowsLaunchFailedError(
      `${report.reason}${report.step ? ` at ${report.step}` : ''} (code ${String(report.code ?? 0)})`
    )
  }
  throw new Error("vshud's Windows launcher did not start the candidate: no launch report.")
}
