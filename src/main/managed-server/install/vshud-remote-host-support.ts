// Windows operations use the host script; only POSIX command builders use this guard.
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'

export class VshudRemoteLaunchUnsupportedError extends Error {
  readonly code = 'vshud_remote_launch_unsupported_host'
  constructor(hostLabel: string) {
    super(
      `This vshud command does not run on a ${hostLabel} host. The install transaction is ` +
        'host-agnostic, but this step is a POSIX command with a separate Windows path.'
    )
    this.name = 'VshudRemoteLaunchUnsupportedError'
  }
}

export function assertPosixVshudHost(host: RemoteHostPlatform): void {
  if (isWindowsRemoteHost(host)) {
    throw new VshudRemoteLaunchUnsupportedError('Windows')
  }
}

/** Candidate stdout containing readiness; bounded below even if other output follows. */
export const VSHUD_READINESS_FILENAME = '.vshud-readiness'
export const VSHUD_LOG_FILENAME = 'vshud.log'
// Candidate stdout is untrusted in size; never read runaway output whole.
export const VSHUD_READINESS_MAX_BYTES = 256 * 1024

export const VSHUD_PID_FILENAME = '.vshud-pid'
/** Pair the PID with boot ID and node name; shared home paths cannot identify a machine. */
export const VSHUD_PID_MACHINE_FILENAME = `${VSHUD_PID_FILENAME}-machine`
/** Emit nothing without a boot ID; launch and later wait compare this identity. */
export const VSHUD_LAUNCH_MACHINE_COMMAND = 'cat /proc/sys/kernel/random/boot_id&&uname -n'

/** Windows pairs PID with creation time because PID reuse alone cannot identify the process. */
export const VSHUD_WINDOWS_PROCESS_FILENAME = '.vshud-process.json'

/** ESRCH text: bash, dash and BusyBox print "No such process"; zsh and ksh print it lowercase (#34149). */
export const POSIX_NO_SUCH_PROCESS_CASE = '*[Nn]"o such process"*'

/** kill -0 includes zombies; ps excludes them, while missing evidence conservatively retains the process. */
export function posixProcessAliveShellFunction(
  options: { refuseUnverifiable?: boolean } = {}
): string {
  // Destructive lifecycle steps need explicit absence; permission failures cannot prove exit.
  const probe = options.refuseUnverifiable
    ? 'probe_error=$(LC_ALL=C kill -0 "$1" 2>&1) || { ' +
      `case "$probe_error" in ${POSIX_NO_SUCH_PROCESS_CASE}) return 1;; ` +
      '*) echo UNKNOWN; exit 0;; esac; }; '
    : 'kill -0 "$1" 2>/dev/null || return 1; '
  return (
    `vshud_alive() { ${probe}` +
    'vshud_stat=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$vshud_stat" ] || ' +
    // Field 3 of /proc/<pid>/stat follows the last ")": comm itself may hold spaces or parens.
    'vshud_stat=$(cat "/proc/$1/stat" 2>/dev/null) && vshud_stat=${vshud_stat##*") "}; ' +
    'case "$vshud_stat" in Z*) return 1;; esac; return 0; };'
  )
}

/** Prints a PID's argv; slim Linux images ship no ps, so fall back to /proc (#34149). */
export function posixProcessArgsShellFunction(): string {
  return (
    'vshud_args() { vshud_argv=$(ps -o args= -p "$1" 2>/dev/null) && [ -n "$vshud_argv" ] || ' +
    '{ vshud_argv=$(tr "\\000" " " 2>/dev/null < "/proc/$1/cmdline") || return 1; ' +
    // Kernel threads and zombies have no argv; their stat line still names them.
    '[ -n "$vshud_argv" ] || vshud_argv=$(cat "/proc/$1/stat" 2>/dev/null) || return 1; }; ' +
    'printf "%s\\n" "$vshud_argv"; };'
  )
}
