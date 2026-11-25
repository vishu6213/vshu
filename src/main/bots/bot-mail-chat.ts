// Where a bot's mail meant for one of its chats lands: that chat while it takes mail, else Home Chat,
// including the reports of workers a room member started once that member's chat closes.
import type { Bot } from '../../shared/bot-types'
import type { BotGroupMember } from '../../shared/bots/bot-group'
import { isVshuSessionId } from '../../shared/agent-session/identity/vshu-session-address'
import { handOverCoordinatorChatRuns } from '../runtime/orchestration/db/runs/run-coordinator-handover'
import type { VshuRuntimeService } from '../runtime/vshu-runtime'
import { closeStructuredAgentSessionChild } from '../runtime/agent-session/lifecycle/structured-agent-session-close'
import { botChatTakingMail } from '../runtime/rpc/methods/bots-chats'
import { runtimeBotChats } from './bot-chat-session'

/** The session mail for `chatId` reaches; Home Chat once that chat takes none (a room deleted or
 *  left, a chat closed), so item changes and worker reports are never left without a reader. */
export async function botMailSession(
  runtime: VshuRuntimeService,
  bot: Bot,
  chatId: string
): Promise<string> {
  return (
    (await botChatTakingMail(runtime, bot, chatId))?.sessionId ??
    (await runtimeBotChats(runtime).ensure(bot.id))
  )
}

/** Closes a room member's chat. The workers it started still report, so its Runs go to the chat
 *  that reads the bot's mail for it now (Home Chat), as its items' mail does. */
export async function closeMemberChat(
  runtime: VshuRuntimeService,
  member: BotGroupMember
): Promise<void> {
  // A closed host would skip the close, leaving the chat taking mail and its Runs where they are.
  await runtime.ensureStructuredAgentSessionHost().catch(() => undefined)
  await closeStructuredAgentSessionChild(member.sessionId, { runtime })
  const db = runtime.getOrchestrationDb()
  const bot = runtime.bots.list().find((entry) => entry.id === member.botId)
  const from = member.sessionId
  if (
    !bot ||
    !isVshuSessionId(from) ||
    db.runsBoundToCoordinator({ vshuSessionId: from, paneKey: null, terminalHandle: null })
      .length === 0
  ) {
    return
  }
  const to = await botMailSession(runtime, bot, from)
  if (isVshuSessionId(to)) {
    handOverCoordinatorChatRuns(db, from, to)
  }
}
