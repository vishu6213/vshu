// Closing the Chat a bot's `/new` or agent change replaces. Once it is proven stopped it will never
// read for its Runs again, so they stop naming it and a later worker ask there is told at once.
import type { VshuRuntimeService } from '../runtime/vshu-runtime'
import {
  closeStructuredAgentSessionChild,
  type StructuredAgentSessionCloseOutcome
} from '../runtime/agent-session/lifecycle/structured-agent-session-close'
import { retireChatRuns } from '../runtime/orchestration/db/runs/retired-coordinator-runs'

type Closed = Pick<StructuredAgentSessionCloseOutcome, 'stopped' | 'reason'>

export async function closeReplacedBotChat(
  runtime: VshuRuntimeService,
  sessionId: string,
  close: (
    sessionId: string,
    options: { runtime: VshuRuntimeService }
  ) => Promise<Closed> = closeStructuredAgentSessionChild
): Promise<Closed> {
  const closed = await close(sessionId, { runtime })
  if (closed.stopped) {
    retireChatRuns(runtime, sessionId)
  }
  return closed
}

/** `/new` and an agent change alike: nothing reads the replaced Chat's unread mail again. */
export async function dropReplacedChatMail(
  runtime: VshuRuntimeService,
  botId: string,
  replaced: string | null
): Promise<void> {
  if (replaced) {
    // Loaded here: the request outcomes reach bot groups, which open Chats through this module.
    const { dropUnreadBotRequests } =
      await import('../runtime/rpc/methods/orchestration/messaging/bot-request-outcome')
    await dropUnreadBotRequests(runtime, botId, 'new-chat', replaced)
  }
}
