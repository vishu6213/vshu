/** macOS pins Local Network attribution at spawn: SSH-launched terminals can lose LAN access after sshd-session exits (#25934; Apple TN3179). Record the nearest session plus start time and matching slot PID; preserve earlier attribution while a live terminal daemon survives vshud restarts. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { VSHUD_PID_FILENAME } from './vshud-remote-host-support'

export const VSHUD_LAUNCH_SSH_SESSION_FILENAME = '.vshud-launch-ssh-session'

const LOCAL_NETWORK_PRIVACY_MAJOR = 15
// Bounds the ancestor walk; real chains are a few processes deep.
const MAX_ANCESTOR_DEPTH = 32

export function recordsVshudLaunchSshSession(host: RemoteHostPlatform): boolean {
  return host.os === 'darwin'
}

/** Choose the nearest sshd ancestor, which exits with this session; a listener farther up would remain alive. */
export function vshudSshSessionAncestorShellFunction(): string {
  return (
    'vshud_ssh_session() { vshud_sp=$1; vshud_si=0; ' +
    `while [ "$vshud_si" -lt ${MAX_ANCESTOR_DEPTH} ]; do ` +
    'case "$vshud_sp" in "" | *[!0-9]* | 0 | 1) return 1;; esac; ' +
    'vshud_sc=$(ps -o comm= -p "$vshud_sp" 2>/dev/null) || return 1; ' +
    'case "${vshud_sc##*/}" in sshd*) ' +
    'vshud_ss=$(ps -o lstart= -p "$vshud_sp" 2>/dev/null) || return 1; ' +
    // Why unquoted: normalizes lstart's padding so a later read compares equal.
    'echo "$vshud_sp" $vshud_ss; return 0;; esac; ' +
    'vshud_sp=$(ps -o ppid= -p "$vshud_sp" 2>/dev/null | tr -d " "); ' +
    'vshud_si=$((vshud_si + 1)); done; return 1; };'
  )
}

/** Capture before detach without failing launch. */
export function captureVshudLaunchSshSessionCommand(): string {
  return (
    `${vshudSshSessionAncestorShellFunction()} ` +
    'vshud_session=$(vshud_ssh_session "$$" 2>/dev/null) || vshud_session=;'
  )
}

function recordPath(host: RemoteHostPlatform, userDataDir: string): string {
  return quotePosixShell(joinRemotePath(host, userDataDir, VSHUD_LAUNCH_SSH_SESSION_FILENAME))
}

/** Return 0 for this root's live daemon, 1 for absence, 2 for unreadable argv; PID files alone may name recycled processes. */
function liveDaemonShellFunction(host: RemoteHostPlatform, userDataDir: string): string {
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  return (
    `vshud_daemon_live() { vshud_ddir=${daemonDir}; for vshud_df in "$vshud_ddir"/daemon-v*.pid; do ` +
    '[ -f "$vshud_df" ] || continue; ' +
    'vshud_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$vshud_df" | head -n 1); ' +
    '[ -n "$vshud_dp" ] || continue; ' +
    'kill -0 "$vshud_dp" 2>/dev/null || continue; ' +
    'vshud_da=$(ps -o args= -p "$vshud_dp" 2>/dev/null); [ -n "$vshud_da" ] || return 2; ' +
    'case "$vshud_da" in *daemon-entry*"$vshud_ddir"* | *"$vshud_ddir"*daemon-entry*) return 0;; esac; ' +
    'done; return 1; };'
  )
}

/** After recording $!, preserve the live daemon's earlier session; otherwise record this launch's session. */
export function writeVshudLaunchSshSessionCommand(
  host: RemoteHostPlatform,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  return (
    // First-deploy detach may run before vshud creates its data root.
    `{ vshud_bg=$!; ( umask 077; mkdir -p ${quotePosixShell(userDataDir)} ); ` +
    `${liveDaemonShellFunction(host, userDataDir)} ` +
    'vshud_daemon_live; vshud_dl=$?; ' +
    'if [ "$vshud_dl" = 0 ]; then ' +
    `vshud_prev=$(cat ${file}); rm -f ${file}; set -- $vshud_prev; ` +
    `[ "$#" -lt 3 ] || { shift; ( umask 077; echo "$vshud_bg" "$@" > ${file} ); }; ` +
    // Unreadable daemon identity leaves attribution unknown, never assigned to this launch.
    `elif [ "$vshud_dl" = 2 ]; then rm -f ${file}; ` +
    `else rm -f ${file}; [ -z "$vshud_session" ] || ` +
    `( umask 077; echo "$vshud_bg" $vshud_session > ${file} ); fi; :; } 2>/dev/null`
  )
}

export function vshudLaunchSshSessionProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, VSHUD_PID_FILENAME))
  return [
    'vshud_mac=$(sw_vers -productVersion 2>/dev/null) || { echo NOT_APPLICABLE; exit 0; };',
    'vshud_major=${vshud_mac%%.*};',
    'case "$vshud_major" in "" | *[!0-9]*) echo UNVERIFIABLE; exit 0;; esac;',
    `[ "$vshud_major" -ge ${LOCAL_NETWORK_PRIVACY_MAJOR} ] || { echo NOT_APPLICABLE; exit 0; };`,
    `vshud_rec=$(cat ${file} 2>/dev/null) || { echo NOT_RECORDED; exit 0; };`,
    `vshud_pid=$(cat ${pidFile} 2>/dev/null);`,
    'set -- $vshud_rec;',
    'case "$1:$2" in *[!0-9:]* | :* | *:) echo NOT_RECORDED; exit 0;; esac;',
    '[ "$1" = "$vshud_pid" ] || { echo NOT_RECORDED; exit 0; };',
    'vshud_sshd=$2; shift 2; vshud_want=$*;',
    // A ps that can't list this shell can't prove another process absent.
    'ps -o pid= -p "$$" >/dev/null 2>&1 || { echo UNVERIFIABLE; exit 0; };',
    'vshud_now=$(ps -o lstart= -p "$vshud_sshd" 2>/dev/null); vshud_now=$(echo $vshud_now);',
    // A reused PID with another start time is a different process: the session is gone.
    'if [ -z "$vshud_now" ] || [ "$vshud_now" != "$vshud_want" ]; then echo EXITED; else echo LIVE; fi'
  ].join(' ')
}

/** `not-recorded` covers older launches and clients: the condition is unknown, never assumed. */
export type VshudLaunchSshSession =
  | 'live'
  | 'exited'
  | 'unverifiable'
  | 'not-recorded'
  | 'not-applicable'

export function parseVshudLaunchSshSession(output: string): VshudLaunchSshSession {
  switch (output.trim().split('\n').pop()?.trim() ?? '') {
    case 'LIVE':
      return 'live'
    case 'EXITED':
      return 'exited'
    case 'NOT_RECORDED':
      return 'not-recorded'
    case 'NOT_APPLICABLE':
      return 'not-applicable'
    default:
      return 'unverifiable'
  }
}
