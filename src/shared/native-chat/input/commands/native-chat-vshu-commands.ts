// Vshu's own `/resume`, `/usage` and `/fork` rows, shared by desktop and phone; each client words them.

import type { SlashCommandSuggestion } from './native-chat-slash-commands'

export const NATIVE_CHAT_RESUME_COMMAND = 'resume'

/** Replace the agent's /resume catalog entry with Vshu's, and its /usage and /fork with Vshu's
 *  where this chat runs them (a description is given). */
export function withNativeChatVshuCommands(
  commands: readonly SlashCommandSuggestion[],
  copy: { resume: string; resumeArgumentHint?: string; usage?: string; fork?: string }
): SlashCommandSuggestion[] {
  const resume: SlashCommandSuggestion = {
    name: NATIVE_CHAT_RESUME_COMMAND,
    description: copy.resume,
    ...(copy.resumeArgumentHint ? { argumentHint: copy.resumeArgumentHint } : {}),
    // OpenCode's session picker is /sessions; chats reach theirs through this row.
    aliases: ['sessions'],
    vshuOwned: true
  }
  let rows = [...commands]
  for (const name of ['usage', 'fork'] as const) {
    const description = copy[name]
    if (description !== undefined) {
      rows = [
        { name, description, vshuOwned: true },
        ...rows.filter((command) => command.name !== name)
      ]
    }
  }
  const at = rows.findIndex(({ name }) => name === NATIVE_CHAT_RESUME_COMMAND)
  return at === -1 ? [...rows, resume] : [...rows.slice(0, at), resume, ...rows.slice(at)]
}
