import { useLayoutEffect } from 'react'
import type { MutableRefObject } from 'react'
import { NATIVE_CHAT_FOLLOW_REARM_PX, type ScrollGeometry } from './native-chat-autoscroll'

type VisibilityScrollArgs = {
  isVisible: boolean
  itemCount: number
  isWorking: boolean
  showsTailRow: boolean
  isVisibleRef: MutableRefObject<boolean>
  previousIsVisibleRef: MutableRefObject<boolean>
  followingRef: MutableRefObject<boolean>
  detachedScrollTopRef: MutableRefObject<number | null>
  clearForwardedScroll: () => void
  observeVisibility: (visible: boolean, revealed: boolean) => void
  performApplicationScroll: (fn: () => void) => void
  restoreScrollOffset: (offset: number) => void
  readerAtEnd: (threshold?: number) => boolean
  syncScrollState: (knownGeometry?: ScrollGeometry) => ScrollGeometry | null
  scrollToEndWhenMeasurable: () => void
}

export function useNativeChatVisibilityScroll(args: VisibilityScrollArgs): void {
  const {
    isVisible,
    itemCount,
    isWorking,
    showsTailRow,
    isVisibleRef,
    previousIsVisibleRef,
    followingRef,
    detachedScrollTopRef,
    clearForwardedScroll,
    observeVisibility,
    performApplicationScroll,
    restoreScrollOffset,
    readerAtEnd,
    syncScrollState,
    scrollToEndWhenMeasurable
  } = args

  useLayoutEffect(() => {
    if (isVisible !== previousIsVisibleRef.current) {
      clearForwardedScroll()
    }
    const revealed = isVisible && !previousIsVisibleRef.current
    isVisibleRef.current = isVisible
    previousIsVisibleRef.current = isVisible
    observeVisibility(isVisible, revealed)
    if (!isVisible) {
      return
    }
    if (!followingRef.current) {
      if (revealed) {
        if (detachedScrollTopRef.current !== null) {
          const offset = detachedScrollTopRef.current
          performApplicationScroll(() => restoreScrollOffset(offset))
        }
        followingRef.current = readerAtEnd(NATIVE_CHAT_FOLLOW_REARM_PX)
      }
      syncScrollState()
      return
    }
    scrollToEndWhenMeasurable()
  }, [
    clearForwardedScroll,
    detachedScrollTopRef,
    followingRef,
    isVisible,
    isVisibleRef,
    itemCount,
    isWorking,
    observeVisibility,
    performApplicationScroll,
    previousIsVisibleRef,
    readerAtEnd,
    restoreScrollOffset,
    scrollToEndWhenMeasurable,
    showsTailRow,
    syncScrollState
  ])
}
