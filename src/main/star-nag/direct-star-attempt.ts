import { starVshu } from '../github/client/fetch/vshu-star'
import { track } from '../telemetry/client'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { type StarNagPromptSession, trackStarNagSessionOutcome } from './prompt-session-telemetry'
import { getStarNagAppStarSource } from './app-star-source'

export async function runStarNagDirectStarAttempt(session: StarNagPromptSession): Promise<boolean> {
  trackStarNagSessionOutcome(session, 'star_clicked', { mode: 'gh' })
  const starred = await starVshu()
  if (!starred) {
    trackStarNagSessionOutcome(session, 'direct_star_failed', { mode: 'gh' })
    session.mode = 'web'
    return false
  }
  trackStarNagSessionOutcome(session, 'direct_star_succeeded', { mode: 'gh' })
  // Keep app_starred_vshu as cross-surface success; star_nag_outcome only accompanies the prompt funnel.
  track('app_starred_vshu', {
    source: getStarNagAppStarSource(session.source),
    ...getCohortAtEmit()
  })
  return true
}
