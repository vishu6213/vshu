// Wait on-host in one bounded exec; repeated SSH polling spawned process bursts and triggered Windows EDR.
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import {
  VSHUD_PID_FILENAME,
  VSHUD_PID_MACHINE_FILENAME,
  VSHUD_READINESS_FILENAME,
  VSHUD_READINESS_MAX_BYTES,
  VSHUD_LAUNCH_MACHINE_COMMAND,
  POSIX_NO_SUCH_PROCESS_CASE
} from './vshud-remote-host-support'
import {
  parseVshudReadinessOutput,
  readVshudReadinessCommand,
  type VshudReadinessParse
} from './vshud-remote-launch'
import {
  vshudWindowsSlotOpCommand,
  readVshudWindowsEncodedAnswer
} from './vshud-remote-windows-node'
import { VSHUD_WINDOWS_READINESS_MARKER } from '../host-state/vshud-windows-host-script'

// Stay below the 30-second exec timeout so waits can answer before channel expiry.
export const VSHUD_READINESS_WAIT_MAX_SECONDS = 20

const VSHUD_LAUNCH_EXITED_MARKER = 'VSHUD_LAUNCH_EXITED'

function posixReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const file = quotePosixShell(joinRemotePath(host, remoteInstallDir, VSHUD_READINESS_FILENAME))
  const read = `head -c ${VSHUD_READINESS_MAX_BYTES + 1} ${file} 2>/dev/null`
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, VSHUD_PID_FILENAME))
  const pidMachine = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, VSHUD_PID_MACHINE_FILENAME)
  )
  return [
    // Fail early only on proven exit from the launching machine; shared homes and unverified PIDs must keep waiting.
    `vshud_launch_here() { vshud_recorded=$(cat ${pidMachine} 2>/dev/null) && [ -n "$vshud_recorded" ] && [ "$vshud_recorded" = "$(${VSHUD_LAUNCH_MACHINE_COMMAND} 2>/dev/null)" ]; };`,
    `vshud_launch_exited() { vshud_launch_here || return 1; pid=$(cat ${pidFile} 2>/dev/null); case "$pid" in "" | *[!0-9]*) return 1;; esac;`,
    `probe_error=$(LC_ALL=C kill -0 "$pid" 2>&1) || { case "$probe_error" in ${POSIX_NO_SUCH_PROCESS_CASE}) return 0;; esac; return 1; };`,
    'case "$(ps -o stat= -p "$pid" 2>/dev/null)" in Z*) return 0;; esac; return 1; };',
    // Probe fractional sleep once; POSIX hosts may support only integer seconds.
    'if sleep 0.05 2>/dev/null; then vshud_readiness_wait_step=0.05; vshud_readiness_full_every=5;',
    'else vshud_readiness_wait_step=1; vshud_readiness_full_every=1; fi;',
    // Bound elapsed time, not iterations: slow filesystem reads otherwise overrun the client exec deadline.
    `vshud_readiness_wait_end=$(($(date +%s) + ${waitSeconds})); vshud_readiness_polls=0;`,
    // Between full checks (every 0.25 s) only a builtin test watches for the file, so polling spawns nothing.
    `while :; do if [ -s ${file} ] || [ $((vshud_readiness_polls % vshud_readiness_full_every)) -eq 0 ]; then`,
    '[ "$(date +%s)" -lt "$vshud_readiness_wait_end" ] || break;',
    `[ "$(${read} | wc -l)" -gt 0 ] && break;`,
    `[ "$(${read} | wc -c)" -gt ${VSHUD_READINESS_MAX_BYTES} ] && break;`,
    `vshud_launch_exited && { echo ${VSHUD_LAUNCH_EXITED_MARKER}; break; };`,
    'fi; vshud_readiness_polls=$((vshud_readiness_polls + 1)); sleep "$vshud_readiness_wait_step"; done;',
    `${read} || true`
  ].join(' ')
}

export function vshudReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const seconds = Math.max(0, Math.min(VSHUD_READINESS_WAIT_MAX_SECONDS, Math.ceil(waitSeconds)))
  if (!isWindowsRemoteHost(host)) {
    return posixReadinessWaitCommand(host, remoteInstallDir, seconds)
  }
  return vshudWindowsSlotOpCommand(host, remoteInstallDir, 'readiness-wait', [
    joinRemotePath(host, remoteInstallDir, VSHUD_READINESS_FILENAME),
    String(VSHUD_READINESS_MAX_BYTES),
    String(seconds)
  ])
}

export function parseVshudReadinessWaitOutput(
  host: RemoteHostPlatform,
  output: string
): VshudReadinessParse {
  return parseVshudReadinessOutput(
    isWindowsRemoteHost(host)
      ? (readVshudWindowsEncodedAnswer(output, VSHUD_WINDOWS_READINESS_MARKER) ?? '')
      : withoutLaunchExitedMarker(output)
  )
}

export function vshudLaunchExitedDuringWait(host: RemoteHostPlatform, output: string): boolean {
  return !isWindowsRemoteHost(host) && output.startsWith(`${VSHUD_LAUNCH_EXITED_MARKER}\n`)
}

function withoutLaunchExitedMarker(output: string): string {
  return output.startsWith(`${VSHUD_LAUNCH_EXITED_MARKER}\n`)
    ? output.slice(VSHUD_LAUNCH_EXITED_MARKER.length + 1)
    : output
}

export function readVshudReadinessNowCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  // Windows host wait with zero delay substitutes for the unavailable head command.
  return isWindowsRemoteHost(host)
    ? vshudReadinessWaitCommand(host, remoteInstallDir, 0)
    : readVshudReadinessCommand(host, remoteInstallDir)
}
