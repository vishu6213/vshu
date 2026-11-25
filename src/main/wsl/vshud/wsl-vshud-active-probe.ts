/**
 * WSL reads an active slot's liveness, readiness and pid in one guest command; SSH keeps
 * `probeActiveVshudReadiness`'s separate reads. The answers are judged exactly as those are.
 */
import type { VshudHostTarget } from '../../managed-server/install/vshud-host-transport'
import type { VshudRemoteContext } from '../../managed-server/install/vshud-remote-context'
import { vshudLivenessProbeCommand } from '../../managed-server/install/vshud-remote-launch'
import { readVshudReadinessNowCommand } from '../../managed-server/install/vshud-remote-readiness-wait'
import { execVshudRemote } from '../../managed-server/install/vshud-remote-runtime-control'
import { VSHUD_PID_FILENAME } from '../../managed-server/install/vshud-remote-host-support'
import { managedVshudInstallDir } from '../../managed-server/lifecycle/vshud-managed-runtime-context'
import {
  activeVshudReadinessFromOutput,
  assertActiveVshudLive,
  VshudActiveReadinessError
} from '../../managed-server/activation/vshud-active-readiness'
import { computeLocalVshudBuildHash } from '../../managed-server/install/vshud-local-build-hash'
import type { ServeReadiness } from '../../server/serve-readiness'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { VSHUD_WSL_HOST_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-server-launch-env'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'

const SECTION_END = '__VSHU_WSL_ACTIVE_PROBE_END__'
const WSL_HOST_LAUNCH = '__VSHU_WSL_HOST_LAUNCH__'
const OTHER_LAUNCH = '__VSHU_OTHER_LAUNCH__'

/**
 * How the serving vshud was started: by a WSL host (it carries the marker), some other way
 * (usually an SSH host pointed at the distro, #43632), or unknown when its environment is unreadable.
 */
export type WslVshudLaunchMode = 'wsl-host' | 'other' | 'unknown'

type WslContext = VshudRemoteContext<VshudHostTarget>

function pidFile(context: WslContext, fullVersion: string): string {
  return quotePosixShell(
    joinRemotePath(context.host, managedVshudInstallDir(context, fullVersion), VSHUD_PID_FILENAME)
  )
}

function pidCommand(context: WslContext, fullVersion: string): string {
  return `cat ${pidFile(context, fullVersion)} 2>/dev/null || true`
}

/**
 * The readiness file says nothing of the launch, so read the process's own environment. An
 * unreadable or empty one (another user's process, a kernel thread) prints nothing: unknown.
 */
function launchModeCommand(context: WslContext, fullVersion: string): string {
  return (
    `vshud_lp=$(cat ${pidFile(context, fullVersion)} 2>/dev/null); case "$vshud_lp" in "" | *[!0-9]*) ;; ` +
    `*) vshud_le=$(tr '\\0' '\\n' 2>/dev/null < "/proc/$vshud_lp/environ"); ` +
    `if [ -n "$vshud_le" ]; then if printf '%s\\n' "$vshud_le" | ` +
    `grep -qx ${quotePosixShell(`${VSHUD_WSL_HOST_ENV}=1`)}; then echo ${WSL_HOST_LAUNCH}; ` +
    `else echo ${OTHER_LAUNCH}; fi; fi;; esac`
  )
}

function parseLaunchMode(output: string): WslVshudLaunchMode {
  // A pid file without its newline runs the pid and the answer together.
  return output.includes(WSL_HOST_LAUNCH)
    ? 'wsl-host'
    : output.includes(OTHER_LAUNCH)
      ? 'other'
      : 'unknown'
}

function parsePid(output: string): number | null {
  const pid = Number.parseInt(output, 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

export async function readWslVshudPid(
  context: WslContext,
  fullVersion: string,
  signal?: AbortSignal
): Promise<number | null> {
  return parsePid(
    await execCommand(context.connection, pidCommand(context, fullVersion), { signal })
  )
}

/** Each section ends with a marker on its own line; the newline before it is the probe's own. */
export function wslVshudActiveProbeCommand(context: WslContext, fullVersion: string): string {
  const installDir = managedVshudInstallDir(context, fullVersion)
  const end = `printf '\\n%s\\n' ${SECTION_END}`
  return [
    vshudLivenessProbeCommand(context.host, installDir),
    end,
    readVshudReadinessNowCommand(context.host, installDir),
    end,
    pidCommand(context, fullVersion),
    // Same section as the pid: parsePid reads only its first number.
    launchModeCommand(context, fullVersion)
  ].join('\n')
}

export async function probeWslActiveVshud(
  context: WslContext,
  localVshudDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<{ readiness: ServeReadiness; pid: number | null; launch: WslVshudLaunchMode }> {
  const output = await execVshudRemote(
    { conn: context.connection, host: context.host, signal },
    wslVshudActiveProbeCommand(context, fullVersion)
  )
  const sections = output.split(`\n${SECTION_END}\n`)
  if (sections.length !== 3) {
    throw new VshudActiveReadinessError(
      'unverifiable',
      `vshud ${fullVersion} process state is unverifiable.`
    )
  }
  const [liveness = '', readiness = '', pid = ''] = sections
  const expectation = { buildHash: computeLocalVshudBuildHash(localVshudDir), fullVersion }
  assertActiveVshudLive(liveness, expectation)
  return {
    readiness: activeVshudReadinessFromOutput(context.host, readiness, expectation),
    pid: parsePid(pid),
    launch: parseLaunchMode(pid)
  }
}
