import { errorMessage } from '../../../shared/errors/error-message'
import { preflightInstalledVshud } from '../install/vshud-remote-preflight'

/** Preflight before any stop; asked to, the candidate also names the daemon generations under the served data root. */
export async function preflightVshudCandidate(
  options: Omit<Parameters<typeof preflightInstalledVshud>[0], 'probeDaemonsUnder'> & {
    userDataDir: string
  },
  probeDaemons: boolean
): Promise<{ hostDaemonProtocols: readonly number[] | undefined } | { failure: string }> {
  try {
    const answer = await preflightInstalledVshud({
      ...options,
      ...(probeDaemons ? { probeDaemonsUnder: options.userDataDir } : {})
    })
    return { hostDaemonProtocols: answer.liveDaemonProtocols ?? undefined }
  } catch (error) {
    options.signal?.throwIfAborted()
    return {
      failure: `Candidate profile preflight failed; the incumbent was not stopped: ${errorMessage(error)}`
    }
  }
}
