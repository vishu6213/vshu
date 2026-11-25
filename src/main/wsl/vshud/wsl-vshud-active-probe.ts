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
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'

const SECTION_END = '__VSHU_WSL_ACTIVE_PROBE_END__'

type WslContext = VshudRemoteContext<VshudHostTarget>

function pidCommand(context: WslContext, fullVersion: string): string {
  const pidFile = joinRemotePath(
    context.host,
    managedVshudInstallDir(context, fullVersion),
    VSHUD_PID_FILENAME
  )
  return `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`
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
    pidCommand(context, fullVersion)
  ].join('\n')
}

export async function probeWslActiveVshud(
  context: WslContext,
  localVshudDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<{ readiness: ServeReadiness; pid: number | null }> {
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
    pid: parsePid(pid)
  }
}
