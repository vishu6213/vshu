// A tab for one of a bot's chats in its home, shown without taking focus.
import type { Bot } from '../../shared/bot-types'
import { folderWorkspaceKey } from '../../shared/workspace/identity/workspace-scope'
import type { VshuRuntimeService } from '../runtime/vshu-runtime'

/** Publishes `sessionId`'s tab in the bot's home without focus; publishing records it visible, so it
 *  lists under the bot and comes back after a restart. */
export function showBotSessionTab(
  runtime: Pick<VshuRuntimeService, 'publishStructuredAgentSessionTab'>,
  bot: Pick<Bot, 'folderWorkspaceId' | 'agent'>,
  sessionId: string
): Promise<void> {
  return runtime.publishStructuredAgentSessionTab({
    workspaceId: folderWorkspaceKey(bot.folderWorkspaceId),
    sessionId,
    agent: bot.agent,
    activate: false
  })
}
