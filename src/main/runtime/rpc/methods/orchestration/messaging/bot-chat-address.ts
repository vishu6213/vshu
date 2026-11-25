// `--to bot:<name> --chat <id>`: mail to one of a bot's chats, which then routes as that chat's
// session address does; `--chat new` starts a new chat for it.
import { botOfAddress, parseBotAddress } from '../../../../../../shared/bot-roster'
import {
  formatVshuSessionAddress,
  isVshuSessionId,
  parseVshuSessionAddress,
  type VshuSessionAddress
} from '../../../../../../shared/agent-session/identity/vshu-session-address'
import { botOfSession } from '../../../../../bots/bot-session-tabs'
import { botNotFound, isBotRequestPurpose } from '../../../../../bots/bot-request-policy'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { VshuRuntimeService } from '../../../../vshu-runtime'
import type { Bot } from '../../../../../../shared/bot-types'
import { resolveItem } from '../../bots-items-write-support'
import { refuse } from './bot-recipient'
import { mayReachBot, sendToBot } from './bot-request-send'
import { itemMailFilesBody, withItemMailFiles } from './bot-item-mail-files'

/** `--chat new`: the receiving bot starts a new chat for a handoff or question. */
export const BOT_NEW_CHAT = 'new'

/** `--chat new` goes with `--to bot:<name>` and a handoff or question, so no other mail (status
 *  included: it brings no job) opens a chat. */
export function assertNewChatAddress(to: string, type: string | undefined): void {
  if (parseBotAddress(to) === null || !isBotRequestPurpose(type) || type === 'status') {
    throw new OrchestrationError(
      'invalid_argument',
      '--chat new starts a new chat on a bot, yours included, so send it with --to bot:<name> and --type handoff or --type question.'
    )
  }
}

/** `--chat` and bot addresses, ahead of ordinary routing: the address mail goes on to, or the
 *  receipt when a bot took it. */
export async function routeBotMail(
  context: Parameters<typeof sendToBot>[0],
  input: Omit<Parameters<typeof sendToBot>[1], 'newChat'> & {
    params: { chat?: string; item?: string; files?: string[] }
    /** From a paired Vshu: files it uploaded to this Vshu's store for the item's chat. */
    attachments?: readonly string[]
  }
): Promise<{ to: string; body?: string } | { receipt: unknown }> {
  const chat = await chatForItem(context.runtime, input.to, input.params)
  const mail = await withItemMailFiles(context.runtime, input)
  const newChat = chat === BOT_NEW_CHAT
  let to = mail.to
  if (newChat) {
    assertNewChatAddress(to, mail.params.type)
  } else if (chat) {
    to = await botChatAddress(context.runtime, to, chat)
  }
  // Checked first so other mail keeps sending without a pause before it is stored.
  const toBot =
    mayReachBot(context.runtime, to, mail.sender) &&
    (await sendToBot(context, { ...mail, to, newChat }))
  if (toBot) {
    return { receipt: toBot.receipt }
  }
  // Ordinary mail takes no image blocks: its admitted files all go in its body.
  return mail.images === input.images ? { to } : { to, body: itemMailFilesBody(mail) }
}

/** `--item <n>` names the chat that owns item n, or the Home Chat once that chat is gone. */
async function chatForItem(
  runtime: VshuRuntimeService,
  to: string,
  { chat, item }: { chat?: string; item?: string }
): Promise<string | undefined> {
  if (item === undefined) {
    return chat
  }
  if (chat !== undefined) {
    throw new OrchestrationError(
      'invalid_argument',
      'Pass --item or --chat, not both. Nothing was sent.'
    )
  }
  const bot = addressedBot(runtime, to, '--item')
  const record = await resolveItem(runtime.botItems.store(), item)
  if (record.ownerBotId !== bot.id) {
    throw new OrchestrationError(
      'invalid_argument',
      `Item ${record.number} is not ${bot.name}'s, so pick one that \`vshu bot item list --bot "${bot.name}"\` lists.`
    )
  }
  const owning = runtime.botItems.owningChat(record)
  return owning.gone ? undefined : owning.id
}

function addressedBot(runtime: VshuRuntimeService, to: string, flag: string): Bot {
  const name = parseBotAddress(to)
  if (name === null) {
    throw new OrchestrationError(
      'invalid_argument',
      `${flag} names one of a bot's ${flag === '--chat' ? 'chats' : 'items'}, so send it with --to bot:<name>.`
    )
  }
  const bots = runtime.bots.list()
  return botOfAddress(bots, name) ?? refuse(botNotFound(name, bots))
}

/** `--to bot:<name> --chat <id>`: the address of that chat, refused unless it is one of that bot's. */
export async function botChatAddress(
  runtime: VshuRuntimeService,
  to: string,
  chat: string
): Promise<VshuSessionAddress> {
  const bot = addressedBot(runtime, to, '--chat')
  await runtime.ensureStructuredAgentSessionHost().catch(() => undefined)
  // `vshu bot chats` prints `chat:<id>`; the bare id and a session address name it too.
  const id = chat.startsWith('chat:') ? chat.slice('chat:'.length) : chat
  const sessionId = parseVshuSessionAddress(id) ?? (isVshuSessionId(id) ? id : null)
  if (!sessionId || botOfSession(runtime.bots, sessionId)?.id !== bot.id) {
    return refuse({
      code: 'bot_chat_not_found',
      message: `${bot.name} has no chat ${chat}, so pick one that \`vshu bot chats --bot "${bot.name}"\` lists.`
    })
  }
  return formatVshuSessionAddress(sessionId)
}
