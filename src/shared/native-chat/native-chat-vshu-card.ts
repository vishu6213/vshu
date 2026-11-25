import type { NativeChatMessage } from './native-chat-types'
import { nativeChatBotMessageCardOf } from './bot-cards/native-chat-bot-card-kind'

/** A card Vshu drew into the transcript (a started worker, a saved automation): drawn even with no
 *  prose, kept when its turn folds, and never the agent speaking. */
export function isNativeChatVshuCard(message: NativeChatMessage): boolean {
  return (
    message.agentStart === true ||
    message.automationSaved !== undefined ||
    message.waitEnded !== undefined ||
    nativeChatBotMessageCardOf(message) !== null ||
    message.automationRunNotStarted !== undefined ||
    message.botItemNote !== undefined ||
    message.vshuNotice !== undefined
  )
}
