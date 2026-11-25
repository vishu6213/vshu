// Whom a bot's running turn acts for, as its Slack posts tell Vshu Cloud (item 167): another Vshu bot
// hears a post as that person. Only the owner's own turn says owner. A session other than the
// verified caller says none, so its post counts as no one, not even the person its turn started for.
import { actsForOwner } from '../../shared/bots/bot-acts-for'
import type { ConnectorTurnFor } from '../../shared/connectors/connector-cloud-contract'
import { isVshuSessionId } from '../../shared/agent-session/identity/vshu-session-address'
import { canonicalVshuSessionId } from '../runtime/orchestration/addressing/session-lineage/canonical-vshu-session-id'
import type { VshuRuntimeService } from '../runtime/vshu-runtime'
import { readBotTurn } from '../runtime/rpc/methods/orchestration/messaging/bot-recipient'

const sameSession = (a: string, b: string): boolean =>
  (isVshuSessionId(a) ? canonicalVshuSessionId(a) : a) ===
  (isVshuSessionId(b) ? canonicalVshuSessionId(b) : b)

/** `callerSessionId`: the session the request came from, when Vshu knows it. */
export async function botTurnFor(
  runtime: VshuRuntimeService,
  sessionId: string,
  callerSessionId: string | undefined
): Promise<ConnectorTurnFor> {
  if (callerSessionId !== undefined && !sameSession(callerSessionId, sessionId)) {
    return 'none'
  }
  try {
    const { turn } = await readBotTurn(runtime, runtime.getOrchestrationDb(), sessionId)
    return actsForOwner(turn.askers) ? 'owner' : 'someone_else'
  } catch (error) {
    console.warn('[bots] could not read whom a turn acts for', error)
    return 'someone_else'
  }
}
