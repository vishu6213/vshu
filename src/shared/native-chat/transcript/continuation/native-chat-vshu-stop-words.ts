import type { AgentSessionVshuStopCause } from '../../../agent-session/lifecycle/stopping/agent-session-vshu-stop'
import { joinSentences } from '../../../text/sentence-joining'

/** English pieces; desktop translates each with the same fallback, the phone keeps English. */
export const NATIVE_CHAT_VSHU_STOP_COPY = {
  update: 'Vshu on {{machine}} restarted for an update while this response was in progress.',
  quit: 'Vshu on {{machine}} was closed while this response was in progress.',
  crash: 'Vshu on {{machine}} stopped unexpectedly while this response was in progress.',
  // A remote graceful stop is a server stop or a shared desktop's quit; "stopped" is true of both.
  remote: 'Vshu on {{machine}} stopped while this response was in progress.',
  canContinue: 'You can continue in this conversation.',
  unnamedServer: 'the remote server'
} as const

export type NativeChatVshuStopCopyId = keyof typeof NATIVE_CHAT_VSHU_STOP_COPY
export type NativeChatVshuStopSay = (id: NativeChatVshuStopCopyId, machine?: string) => string

export const sayNativeChatVshuStopEnglish: NativeChatVshuStopSay = (id, machine) =>
  machine === undefined
    ? NATIVE_CHAT_VSHU_STOP_COPY[id]
    : NATIVE_CHAT_VSHU_STOP_COPY[id].replace('{{machine}}', () => machine)

/** Base wording on host continuation support so the sentence stays stable as the button changes. */
export function nativeChatVshuStopRowText(
  cause: AgentSessionVshuStopCause,
  machine: string,
  options: { continueAvailable: boolean; remoteHost: boolean },
  say: NativeChatVshuStopSay = sayNativeChatVshuStopEnglish
): string {
  const stopped = say(cause === 'quit' && options.remoteHost ? 'remote' : cause, machine)
  return options.continueAvailable ? stopped : joinSentences([stopped, say('canContinue')])
}
