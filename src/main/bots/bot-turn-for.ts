// Whom a bot's running turn acts for, as its Slack actions tell Vshu Cloud (item 167): another Vshu bot
// hears a post as that person, and a read by the owner's turn reads as the owner. Only the owner's own
// turn says owner. A session other than the verified caller says none, so its post counts as no one,
// not even the person its turn started for.
import type { ConnectorTurnFor } from '../../shared/connectors/connector-cloud-contract'
import { isVshuSessionId } from '../../shared/agent-session/identity/vshu-session-address'
import { canonicalVshuSessionId } from '../runtime/orchestration/addressing/session-lineage/canonical-vshu-session-id'
import type { VshuRuntimeService } from '../runtime/vshu-runtime'
import { readBotTurn } from '../runtime/rpc/methods/orchestration/messaging/bot-recipient'
import { turnActsForOwner, type BotActingTurn } from './bot-request-asker'

/** Whether two ids name one agent session, however each is spelled. */
export const sameSession = (a: string, b: string): boolean =>
  (isVshuSessionId(a) ? canonicalVshuSessionId(a) : a) ===
  (isVshuSessionId(b) ? canonicalVshuSessionId(b) : b)

/** `callerSessionId`: the session the request came from, when Vshu knows it. `known`: the running
 *  turn, when the caller already read it. */
export async function botTurnFor(
  runtime: VshuRuntimeService,
  sessionId: string,
  callerSessionId: string | undefined,
  known?: BotActingTurn
): Promise<ConnectorTurnFor> {
  if (callerSessionId !== undefined && !sameSession(callerSessionId, sessionId)) {
    return 'none'
  }
  try {
    const turn = known ?? (await readBotTurn(runtime, runtime.getOrchestrationDb(), sessionId)).turn
    return turnActsForOwner(turn) ? 'owner' : 'someone_else'
  } catch (error) {
    console.warn('[bots] could not read whom a turn acts for', error)
    return 'someone_else'
  }
}
