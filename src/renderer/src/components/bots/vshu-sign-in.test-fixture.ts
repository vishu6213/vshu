// This window's Vshu account, signed in or out, for tests and screenshots of what waits on sign-in.
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { VshuProfileAuthStatus } from '../../../../shared/vshu-profiles/vshu-profiles'
import type { NativeChatBotKickoffView } from '../native-chat/native-chat-bot-kickoff-view'

export const VSHU_CONNECTED: VshuProfileAuthStatus = {
  activeProfileId: 'p1',
  configured: true,
  state: 'connected',
  persistence: 'encrypted'
}
export const VSHU_SIGNED_OUT: VshuProfileAuthStatus = { ...VSHU_CONNECTED, state: 'local' }

/** Sign in as the browser would finish it: `before` runs, then the window is signed in. */
export function vshuSignIn(before?: () => unknown): AppState['connectCurrentVshuProfile'] {
  return async () => {
    await before?.()
    useAppStore.setState({ vshuProfileAuthStatus: VSHU_CONNECTED })
    return { status: 'connected', auth: VSHU_CONNECTED, activeProfileId: 'p1', profiles: [] }
  }
}

/** A bot chat that takes every send. */
export function chatTakingSends(
  send: (text: string) => Promise<boolean>
): NativeChatBotKickoffView {
  return {
    live: false,
    send,
    sendBlockedReason: () => undefined,
    bot: null,
    sessionId: 'chat-1',
    firstScreen: null,
    firstKickoffId: null
  }
}
