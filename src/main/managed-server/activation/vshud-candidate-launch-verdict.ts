import { evaluateVshudActivation, type VshudActivationVerdict } from './vshud-activation-gate'
import { vshudActivationTransactionRoot } from './vshud-activation-transaction'
import type { VshudReadinessParse } from '../install/vshud-remote-launch'
import {
  launchVshudAndAwaitReadiness,
  type VshudRemoteExecTarget
} from '../install/vshud-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'

type CandidateLaunchTarget = Parameters<typeof launchVshudAndAwaitReadiness>[0] &
  VshudRemoteExecTarget & {
    remoteHome: string
    nodePath: string
    userDataDir: string
    bindHost: string
    port: number
  }

/** Rethrow unconfirmed SSH cleanup: it provides no candidate evidence and must never mean rejection. */
export async function launchAndJudgeVshudSlot(
  options: CandidateLaunchTarget,
  slot: { remoteInstallDir: string; fullVersion: string; buildHash: string }
): Promise<{ verdict: VshudActivationVerdict; launchError: unknown }> {
  let parsed: VshudReadinessParse | null = null
  let launchError: unknown
  try {
    parsed = await launchVshudAndAwaitReadiness(options, {
      remoteInstallDir: slot.remoteInstallDir,
      nodePath: options.nodePath,
      fullVersion: slot.fullVersion,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      activationRoot: vshudActivationTransactionRoot(options.host, options.remoteHome)
    })
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    launchError = error
  }
  const verdict = evaluateVshudActivation(parsed?.state === 'ready' ? parsed.readiness : null, {
    buildHash: slot.buildHash,
    fullVersion: slot.fullVersion
  })
  return { verdict, launchError }
}
