import { errorMessage } from '../../../shared/errors/error-message'
import {
  VshudPreflightUnansweredError,
  preflightInstalledVshud
} from '../install/vshud-remote-preflight'

type VshudCandidatePreflightFailure = {
  // A failed preflight is remembered as host incompatibility; an unanswered one is retried next connect.
  code: 'vshud_candidate_preflight_failed' | 'vshud_candidate_preflight_unanswered'
  failure: string
}

/** Preflight before any stop; asked to, the candidate also names the daemon generations under the served data root. */
export async function preflightVshudCandidate(
  options: Omit<Parameters<typeof preflightInstalledVshud>[0], 'probeDaemonsUnder'> & {
    userDataDir: string
  },
  probeDaemons: boolean
): Promise<
  { hostDaemonProtocols: readonly number[] | undefined } | VshudCandidatePreflightFailure
> {
  try {
    const answer = await preflightInstalledVshud({
      ...options,
      ...(probeDaemons ? { probeDaemonsUnder: options.userDataDir } : {})
    })
    return { hostDaemonProtocols: answer.liveDaemonProtocols ?? undefined }
  } catch (error) {
    options.signal?.throwIfAborted()
    return {
      code:
        error instanceof VshudPreflightUnansweredError
          ? 'vshud_candidate_preflight_unanswered'
          : 'vshud_candidate_preflight_failed',
      failure: `Candidate profile preflight failed; the incumbent was not stopped: ${errorMessage(error)}`
    }
  }
}
