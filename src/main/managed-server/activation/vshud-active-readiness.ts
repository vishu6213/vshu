import { evaluateVshudActivation, type VshudActivationExpectation } from './vshud-activation-gate'
import {
  vshudLivenessProbeCommand,
  parseVshudLiveness,
  type VshudLaunchSpec,
  type VshudReadinessParse
} from '../install/vshud-remote-launch'
import {
  execVshudRemote,
  launchVshudAndAwaitReadiness,
  type VshudRemoteExecTarget
} from '../install/vshud-remote-runtime-control'
import {
  parseVshudReadinessWaitOutput,
  readVshudReadinessNowCommand
} from '../install/vshud-remote-readiness-wait'
import type { ServeReadiness } from '../../server/serve-readiness'
import { withVshudLogTail } from '../install/vshud-remote-log-tail'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

type VshudReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class VshudActiveReadinessError extends Error {
  constructor(
    readonly verdict: VshudReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'VshudActiveReadinessError'
  }
}

/** A launched vshud that did not publish acceptable readiness; inspection failures stay the base error. */
export class VshudLaunchReadinessError extends VshudActiveReadinessError {
  constructor(verdict: VshudReadinessFailureVerdict, message: string) {
    super(verdict, message)
    this.name = 'VshudLaunchReadinessError'
  }
}

function gatedReadiness(
  parsed: VshudReadinessParse,
  expectation: VshudActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateVshudActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new VshudActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new VshudActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  const coverage = vshudDaemonCoverageRefusal(readiness)
  if (coverage) {
    throw new VshudActiveReadinessError('rejected', `${label} ${coverage}`)
  }
  return readiness
}

/** Require PTY self-test coverage, or handshake on platforms that cannot spawn-probe. Older slots without coverage metadata retain the identity-only gate. */
function vshudDaemonCoverageRefusal(readiness: ServeReadiness): string | null {
  const health = readiness.health
  const coverage = health?.terminalDaemon?.selfTest?.coverage
  if (!health || coverage === undefined || coverage === 'pty-spawn') {
    return null
  }
  if (coverage === 'handshake' && health.platform === 'win32') {
    return null
  }
  return (
    `reported terminal-daemon coverage '${String(coverage)}', which does not prove a PTY can ` +
    `be created on ${health.platform}.`
  )
}

export async function probeActiveVshudReadiness(
  target: VshudRemoteExecTarget & { remoteInstallDir: string },
  expectation: VshudActivationExpectation
): Promise<ServeReadiness> {
  assertActiveVshudLive(
    await execVshudRemote(target, vshudLivenessProbeCommand(target.host, target.remoteInstallDir)),
    expectation
  )
  return activeVshudReadinessFromOutput(
    target.host,
    await execVshudRemote(
      target,
      readVshudReadinessNowCommand(target.host, target.remoteInstallDir)
    ),
    expectation
  )
}

/** Throws unless the liveness probe's answer proves the active slot's process is running. */
export function assertActiveVshudLive(
  livenessOutput: string,
  expectation: VshudActivationExpectation
): void {
  const liveness = parseVshudLiveness(livenessOutput)
  if (liveness === 'DEAD') {
    throw new VshudActiveReadinessError(
      'exited',
      `vshud ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness === 'NEVER_LAUNCHED') {
    throw new VshudActiveReadinessError(
      'exited',
      `vshud ${expectation.fullVersion} is recorded active but was never started from its install directory.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new VshudActiveReadinessError(
      'unverifiable',
      `vshud ${expectation.fullVersion} process state is unverifiable.`
    )
  }
}

export function activeVshudReadinessFromOutput(
  host: RemoteHostPlatform,
  readinessOutput: string,
  expectation: VshudActivationExpectation
): ServeReadiness {
  return gatedReadiness(
    parseVshudReadinessWaitOutput(host, readinessOutput),
    expectation,
    'The active vshud'
  )
}

/** Accept recovery/rollback launches only when they prove the expected build. */
export async function launchVshudSlotAndAwaitReadiness(
  target: VshudRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: VshudLaunchSpec,
  expectation: VshudActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchVshudAndAwaitReadiness(target, spec)
  try {
    return gatedReadiness(parsed, expectation, `vshud ${spec.fullVersion}`)
  } catch (error) {
    if (!(error instanceof VshudActiveReadinessError)) {
      throw error
    }
    const message = await withVshudLogTail(target, spec.remoteInstallDir, error.message)
    throw new VshudLaunchReadinessError(error.verdict, message)
  }
}
