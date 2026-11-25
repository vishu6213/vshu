import type { NativeChatUsageLimitAutoContinueState } from '../../usage/native-chat-usage-limit-auto-continue-setting'
import { createContext, useContext } from 'react'

/** Host stop details; only hosts known not to support continuation suppress Continue. */
export type NativeChatVshuStopView = {
  hostLabel: string | null
  remoteHost: boolean
  /** The WSL distro a WSL host runs in, so failure rows can name where an agent is missing. */
  wslDistro?: string | null
  continueAvailable: boolean
  offeredTurnItemId: string | null
  continueNow: () => void
  usageLimitTurnItemId: string | null
  usageLimitAutoContinue?: NativeChatUsageLimitAutoContinueState | null
  /** Settled: this host can't auto-continue by this machine's setting, so offer no control for it. */
  usageLimitAutoContinueUnavailable?: boolean
  /** When Continue past the usage limit applies; earlier than its reset after an account switch. */
  usageLimitContinueAt?: number
  onUsageLimitHandOffStarted?: () => void
  usageLimitContinueDisabled?: boolean
  continueUsageLimit: (hadFocus?: boolean) => void
}

export const NativeChatVshuStopContext = createContext<NativeChatVshuStopView>({
  hostLabel: null,
  remoteHost: false,
  continueAvailable: false,
  offeredTurnItemId: null,
  continueNow: () => {},
  usageLimitTurnItemId: null,
  continueUsageLimit: () => {}
})

export function useNativeChatVshuStopView(): NativeChatVshuStopView {
  return useContext(NativeChatVshuStopContext)
}
