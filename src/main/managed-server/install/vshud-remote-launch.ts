// Redirect detached candidate stdout to its version directory so readiness does not hold SSH open.
import type { VshudLaunchEnvEntry } from './vshud-host-transport'
import {
  VSHUD_LAUNCHER_FILENAME,
  VSHUD_SERVER_ENTRY_FILENAME
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  remoteBasename,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { RELAY_REMOTE_DIR } from './remote-install-root'
import { VSHUD_WSL_HOST_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-server-launch-env'
import {
  assertPosixVshudHost as assertPosixHost,
  VSHUD_LOG_FILENAME,
  VSHUD_PID_FILENAME,
  VSHUD_LAUNCH_MACHINE_COMMAND,
  VSHUD_PID_MACHINE_FILENAME,
  VSHUD_READINESS_FILENAME,
  VSHUD_READINESS_MAX_BYTES,
  posixProcessAliveShellFunction,
  posixProcessArgsShellFunction
} from './vshud-remote-host-support'
import type { ServeReadiness } from '../../server/serve-readiness'
import { selectVshudSlotRuntimeCommand } from './vshud-remote-runtime'
import { VSHUD_STOP_REQUEST_FILENAME } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { vshudWindowsSlotOpCommand } from './vshud-remote-windows-node'
import {
  captureVshudLaunchSshSessionCommand,
  recordsVshudLaunchSshSession,
  writeVshudLaunchSshSessionCommand
} from './vshud-launch-ssh-session'
import {
  VSHUD_E2E_IDLE_TIMEOUT_ENV,
  readVshudE2EIdleTimeoutMs
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-idle-exit'
import { VSHUD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-managed-launch-env'

export type VshudLaunchSpec = {
  remoteInstallDir: string
  nodePath: string
  fullVersion: string
  /** Shared across versions; rollback requires a snapshot. */
  userDataDir: string
  bindHost: string
  port: number
  /** Shared activation fence; managed SSH launches may idle out. */
  activationRoot: string
}

/** Older vshud versions ignore these launch variables. */
export function vshudManagedLaunchEnv(
  spec: VshudLaunchSpec,
  env: NodeJS.ProcessEnv = process.env
): [string, string][] {
  const e2eTimeout = readVshudE2EIdleTimeoutMs(env)
  return [
    [VSHUD_MANAGED_ACTIVATION_ROOT_ENV, spec.activationRoot],
    ...(e2eTimeout === null
      ? []
      : [[VSHUD_E2E_IDLE_TIMEOUT_ENV, String(e2eTimeout)] satisfies [string, string]])
  ]
}

/** WSL without systemd kills nohup children with wsl.exe --exec; use a separate session. */
export type VshudLaunchDetach = 'nohup' | 'setsid'

const VSHUD_SETSID_PID_WAIT_TRIES = 100

/** Halving V8's 16 MB semi-spaces saves ~30 MB idle RSS; a CLI flag because the heap cannot be resized later. */
export const VSHUD_RUNTIME_V8_FLAGS = '--max-semi-space-size=8'

/** Pass bind explicitly so launch policy cannot change with installed-version defaults. */
export function vshudLaunchCommand(
  host: RemoteHostPlatform,
  spec: VshudLaunchSpec,
  detach: VshudLaunchDetach = 'nohup',
  hostEnv: readonly VshudLaunchEnvEntry[] = []
): string {
  assertPosixHost(host)
  const dir = quotePosixShell(spec.remoteInstallDir)
  // Relative artifact paths reduce command size; every use follows the same-shell cd.
  const readiness = quotePosixShell(VSHUD_READINESS_FILENAME)
  const log = quotePosixShell(VSHUD_LOG_FILENAME)
  // PID writes run outside nohup’s backgrounded cd; reuse one absolute path to stay within command budgets.
  const pidFile = '"$vshud_pid"'
  // Liveness matches runtime argv against the absolute entry path.
  const entry = quotePosixShell(
    joinRemotePath(host, spec.remoteInstallDir, VSHUD_LAUNCHER_FILENAME)
  )
  const baseDir = remoteDirname(spec.remoteInstallDir.replace(/\/+$/u, ''), host)
  // Tighten only the managed root, never an unrelated custom-slot parent.
  const privateDirs = [
    ...(remoteBasename(baseDir, host) === RELAY_REMOTE_DIR ? [baseDir] : []),
    spec.remoteInstallDir
  ]
  // Capture in the launching shell; detached subshell variables do not return here.
  const recordSession = detach === 'nohup' && recordsVshudLaunchSshSession(host)
  const launchEnv = [
    `VSHU_VERSION=${quotePosixShell(spec.fullVersion)}`,
    `VSHU_USER_DATA=${quotePosixShell(spec.userDataDir)}`,
    ...vshudManagedLaunchEnv(spec).map(([name, value]) => `${name}=${quotePosixShell(value)}`)
  ]
  return [
    `vshud_pid=${quotePosixShell(joinRemotePath(host, spec.remoteInstallDir, VSHUD_PID_FILENAME))};`,
    // Record the launching machine before detaching; absent boot identity leaves it unverified.
    `{ ${VSHUD_LAUNCH_MACHINE_COMMAND};}>"$vshud_pid${VSHUD_PID_MACHINE_FILENAME.slice(VSHUD_PID_FILENAME.length)}" 2>/dev/null;`,
    ...(recordSession ? [captureVshudLaunchSshSessionCommand()] : []),
    // Preserve login umask for daemon children creating user files.
    'vshud_login_umask=$(umask);',
    // Pairing-token artifacts need umask 077 from creation; semicolon also covers the external PID write.
    'umask 077;',
    // Tighten existing artifacts best-effort; umask cannot repair their modes.
    `{ chmod 700 ${privateDirs.map(quotePosixShell).join(' ')} 2>/dev/null || :; } &&`,
    `cd ${dir} &&`,
    `${selectVshudSlotRuntimeCommand(host, spec.remoteInstallDir, spec.nodePath)} &&`,
    // Truncate so relaunch cannot activate on the previous process’s readiness.
    `: > ${readiness} &&`,
    // Required: truncating redirects retain old file modes.
    `chmod 600 ${readiness} &&`,
    `{ chmod 600 ${pidFile} ${log} 2>/dev/null || :; } &&`,
    `rm -f ${quotePosixShell(VSHUD_STOP_REQUEST_FILENAME)} &&`,
    ...(detach === 'setsid' ? [`rm -f ${pidFile} &&`] : []),
    ...(detach === 'setsid'
      ? setsidLaunchTail(entry, spec, readiness, log, pidFile, launchEnv, hostEnv)
      : [
          // Open redirects under 077 before restoring daemon login umask.
          '{ umask "$vshud_login_umask" &&',
          ...launchEnv,
          // exec keeps $! equal to runtime PID; in-place launcher loading also preserves older clients’ argv checks.
          `exec nohup "$vshud_runtime" $vshud_runtime_flags ${VSHUD_RUNTIME_V8_FLAGS} ${entry}`,
          `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(spec.port)};`,
          `} > ${readiness} 2>> ${log} < /dev/null &`,
          `echo $! > ${pidFile} &&`,
          ...(recordSession
            ? [`${writeVshudLaunchSshSessionCommand(host, spec.userDataDir)} &&`]
            : []),
          `cat ${pidFile}`
        ])
  ].join(' ')
}

/** setsid -f exits its parent, so the exec child records $$; BusyBox uses background setsid without -f. */
function setsidLaunchTail(
  entry: string,
  spec: VshudLaunchSpec,
  readiness: string,
  log: string,
  pidFile: string,
  launchEnv: readonly string[],
  hostEnv: readonly VshudLaunchEnvEntry[]
): string[] {
  return [
    ...launchEnv,
    // Only WSL setsid launches receive this marker.
    `${VSHUD_WSL_HOST_ENV}=1`,
    ...hostEnv.map(launchEnvAssignment),
    'sh -c \'vshud_detach() { if setsid -f true >/dev/null 2>&1; then setsid -f "$@"; ' +
      'else setsid "$@" & fi; }; vshud_detach "$@"\' vshud-detach',
    `sh -c 'echo $$ > "$1" && umask "$2" && shift 2 && exec "$@"' vshud-launch ${pidFile}`,
    '"$vshud_login_umask"',
    `"$vshud_runtime" $vshud_runtime_flags ${VSHUD_RUNTIME_V8_FLAGS} ${entry}`,
    `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(spec.port)}`,
    `> ${readiness} 2>> ${log} < /dev/null &&`,
    `vshud_wait=0; while [ ! -s ${pidFile} ] && [ "$vshud_wait" -lt ${VSHUD_SETSID_PID_WAIT_TRIES} ];`,
    'do sleep 0.05; vshud_wait=$((vshud_wait + 1)); done;',
    `cat ${pidFile}`
  ]
}

function launchEnvAssignment([name, value, mode]: VshudLaunchEnvEntry): string {
  if (mode !== 'keep-existing') {
    return `${assertEnvName(name)}=${quotePosixShell(value)}`
  }
  // Inside "${NAME:-default}" quotes are literal, so only quote-free defaults are expressible.
  if (!/^[A-Za-z0-9._=:,/-]+$/.test(value)) {
    throw new Error(`vshud_launch_env_default_invalid:${name}`)
  }
  return `${assertEnvName(name)}="\${${name}:-${value}}"`
}

function assertEnvName(name: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new Error(`vshud_launch_env_name_invalid:${name}`)
  }
  return name
}

export function readVshudReadinessCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  assertPosixHost(host)
  const readiness = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, VSHUD_READINESS_FILENAME)
  )
  return `head -c ${VSHUD_READINESS_MAX_BYTES + 1} ${readiness} 2>/dev/null || true`
}

/** LIVE/DEAD/UNKNOWN distinguish proven state from missing/denied identity probes.
 * No PID or readiness file means NEVER_LAUNCHED, which also proves this slot has no process. */
export function vshudLivenessProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return vshudWindowsSlotOpCommand(host, remoteInstallDir, 'liveness', [remoteInstallDir])
  }
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, VSHUD_PID_FILENAME))
  const readiness = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, VSHUD_READINESS_FILENAME)
  )
  const launcher = quotePosixShell(joinRemotePath(host, remoteInstallDir, VSHUD_LAUNCHER_FILENAME))
  const server = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, VSHUD_SERVER_ENTRY_FILENAME)
  )
  return [
    posixProcessAliveShellFunction({ refuseUnverifiable: true }),
    posixProcessArgsShellFunction(),
    // PID reuse needs argv identity; absent ps leaves conservative liveness checks to decide.
    `vshud_launcher=${launcher}; vshud_server=${server};`,
    // The probe's own shell, or the shell wrapping it, carries the slot paths in its argv; after a
    // restart either can hold the old PID. A shell elsewhere may be an older launcher's live parent.
    'vshud_reused() { { [ "$1" = "$$" ] || [ "$1" = "$PPID" ]; } && return 0; ' +
      'args=$(vshud_args "$1") && [ -n "$args" ] && ' +
      'case "$args" in *"$vshud_launcher"* | *"$vshud_server"*) return 1;; *) return 0;; esac; };',
    `pid=$(cat ${pidFile} 2>/dev/null);`,
    'case "$pid" in',
    `"" ) if [ -e ${pidFile} ] || [ -e ${readiness} ]; then echo UNKNOWN; else echo ${VSHUD_NEVER_LAUNCHED}; fi;;`,
    '*[!0-9]* ) echo UNKNOWN;;',
    '* ) if vshud_reused "$pid"; then echo DEAD; elif vshud_alive "$pid"; then echo LIVE; else echo DEAD; fi;;',
    'esac'
  ].join(' ')
}

export const VSHUD_NEVER_LAUNCHED = 'NEVER_LAUNCHED'

export type VshudLiveness = 'LIVE' | 'DEAD' | 'UNKNOWN' | typeof VSHUD_NEVER_LAUNCHED

export function parseVshudLiveness(output: string): VshudLiveness {
  const value = output.trim().split('\n').pop()?.trim()
  return value === 'LIVE' || value === 'DEAD' || value === VSHUD_NEVER_LAUNCHED ? value : 'UNKNOWN'
}

/** Only DEAD/NEVER_LAUNCHED permit lifecycle changes; UNKNOWN proves nothing. */
export function vshudLivenessProvenExited(liveness: VshudLiveness): boolean {
  return liveness === 'DEAD' || liveness === VSHUD_NEVER_LAUNCHED
}

export function vshudLivenessAnswerBlocksGc(output: string): boolean {
  return vshudLivenessBlocksGc(parseVshudLiveness(output))
}

export function vshudLivenessBlocksGc(liveness: VshudLiveness): boolean {
  return !vshudLivenessProvenExited(liveness)
}

export type VshudReadinessParse =
  | { state: 'ready'; readiness: ServeReadiness }
  | { state: 'pending' }
  | { state: 'malformed'; reason: string }

/** Treat an unfinished last line as pending; polling can race a candidate stdout append. */
export function parseVshudReadinessOutput(raw: string): VshudReadinessParse {
  if (Buffer.byteLength(raw, 'utf8') > VSHUD_READINESS_MAX_BYTES) {
    return { state: 'malformed', reason: 'readiness payload exceeds the 256 KiB limit' }
  }
  const lines = raw.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Only an unterminated last line can recover from a partial write.
      return index === lines.length - 1
        ? { state: 'pending' }
        : { state: 'malformed', reason: 'readiness line is not valid JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue
    }
    const payload = parsed as { type?: unknown }
    if (payload.type !== 'vshu_server_ready') {
      return {
        state: 'malformed',
        reason: `expected an vshu_server_ready line, got type=${JSON.stringify(payload.type)}`
      }
    }
    return { state: 'ready', readiness: toServeReadiness(payload as Record<string, unknown>) }
  }
  return { state: 'pending' }
}

function toServeReadiness(payload: Record<string, unknown>): ServeReadiness {
  return {
    runtimeId: typeof payload.runtimeId === 'string' ? payload.runtimeId : '',
    boundEndpoint: typeof payload.boundEndpoint === 'string' ? payload.boundEndpoint : null,
    advertisedEndpoint:
      typeof payload.advertisedEndpoint === 'string' ? payload.advertisedEndpoint : null,
    managedWslCliReconciliation:
      payload.managedWslCliReconciliation === 'pending' ||
      payload.managedWslCliReconciliation === 'failed'
        ? payload.managedWslCliReconciliation
        : 'settled',
    pairing: payload.pairing as ServeReadiness['pairing'],
    ...(payload.health ? { health: payload.health as ServeReadiness['health'] } : {})
  }
}
