import { overlayEnvironmentVariables } from '../../shell/launch/environment-overlay'

export const CLAUDE_ENTRYPOINT_ENV = 'CLAUDE_CODE_ENTRYPOINT'
const VSHU_CLAUDE_CHAT_ENTRYPOINT = 'vshu'

/** Only structured chats own this identity; other Claude processes retain their CLI default. */
export function withVshuClaudeChatEntrypoint(
  env: Readonly<Record<string, string>>,
  platform: NodeJS.Platform
): Record<string, string> {
  return overlayEnvironmentVariables(
    env,
    { [CLAUDE_ENTRYPOINT_ENV]: VSHU_CLAUDE_CHAT_ENTRYPOINT },
    platform
  )
}
