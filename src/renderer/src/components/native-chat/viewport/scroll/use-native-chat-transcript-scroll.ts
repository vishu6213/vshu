import { useNativeChatViewDisconnect } from '../../pane/ownership/use-native-chat-view-disconnect'
import { useNativeChatReaderReturn } from './use-native-chat-reader-return'
import { useNativeChatTranscriptResize } from './use-native-chat-transcript-resize'
import { useNativeChatForwardedScroll } from './use-native-chat-forwarded-scroll'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIEventHandler } from 'react'
import { useNativeChatVisibilityScroll } from './use-native-chat-visibility-scroll'
import {
  distanceFromBottom,
  geometryOf,
  hasMeasurableViewport,
  isNearBottom,
  NATIVE_CHAT_FOLLOW_REARM_PX,
  nextFollowingEnd,
  readerGestureDirection,
  type ReaderGesture,
  shouldShowJumpToLatest,
  type ScrollGeometry
} from './native-chat-autoscroll'
import type {
  NativeChatTranscriptScroll,
  NativeChatTranscriptScrollOptions
} from './native-chat-transcript-scroll-types'
import type { NativeChatAlignEdge } from '../virtualization/use-native-chat-viewport-align'

export function useNativeChatTranscriptScroll(
  options: NativeChatTranscriptScrollOptions
): NativeChatTranscriptScroll {
  const {
    scrollRef,
    contentRef,
    itemCount,
    isWorking,
    showsTailRow,
    isVisible,
    alignToViewportTop,
    isAlignPending,
    scrollToEnd,
    restoreScrollOffset,
    consumeProgrammaticScroll,
    reconcileReaderScroll,
    onLeaveEnd,
    onReturnToEnd
  } = options
  const [showJump, setShowJump] = useState(false)
  const followingRef = useRef(true)
  const previousGeometryRef = useRef<ScrollGeometry | null>(null)
  const readerReturn = useNativeChatReaderReturn(scrollRef, followingRef, previousGeometryRef)
  const { performApplicationScroll, observeVisibility, readerAtEnd } = readerReturn
  const detachedScrollTopRef = useRef<number | null>(null)
  const isVisibleRef = useRef(isVisible)
  const previousIsVisibleRef = useRef(isVisible)
  const previousDistanceFromEndRef = useRef(Number.POSITIVE_INFINITY)

  const {
    forwardedInputRef,
    forwardedMovementRef,
    deferredPinRef,
    clearForwardedScroll,
    invalidateForwardedGesture,
    expireForwardedScroll: scheduleForwardedExpire
  } = useNativeChatForwardedScroll()
  const expireForwardedScroll = useCallback(
    () =>
      scheduleForwardedExpire(() => {
        if (
          followingRef.current &&
          isVisibleRef.current &&
          hasMeasurableViewport(scrollRef.current)
        ) {
          performApplicationScroll(scrollToEnd)
        }
      }),
    [performApplicationScroll, scheduleForwardedExpire, scrollRef, scrollToEnd]
  )
  useEffect(() => clearForwardedScroll, [clearForwardedScroll])

  const syncScrollState = useCallback(
    (knownGeometry?: ScrollGeometry): ScrollGeometry | null => {
      const element = scrollRef.current
      if (!isVisibleRef.current || !hasMeasurableViewport(element)) {
        return null
      }
      const geometry = knownGeometry ?? geometryOf(element)
      detachedScrollTopRef.current = followingRef.current ? null : geometry.scrollTop
      setShowJump(shouldShowJumpToLatest(followingRef.current, geometry))
      return geometry
    },
    [scrollRef]
  )

  const readerLeavesEnd = useCallback(() => {
    clearForwardedScroll()
    followingRef.current = false
    onLeaveEnd?.()
    const element = scrollRef.current
    if (element) {
      previousDistanceFromEndRef.current = distanceFromBottom(geometryOf(element))
    }
    // Replace a pending virtualizer target before the browser applies the gesture.
    reconcileReaderScroll(true)
    syncScrollState()
  }, [clearForwardedScroll, onLeaveEnd, reconcileReaderScroll, scrollRef, syncScrollState])

  const observeForwardedMovement = useCallback(
    (geometry: ScrollGeometry, programmatic: boolean) => {
      const previous = previousGeometryRef.current
      if (!followingRef.current) {
        clearForwardedScroll()
        return
      }
      if (programmatic || isAlignPending()) {
        invalidateForwardedGesture()
        return
      }
      if (
        !previous ||
        geometry.scrollHeight - geometry.clientHeight <
          previous.scrollHeight - previous.clientHeight
      ) {
        return
      }
      if (
        geometry.scrollTop < previous.scrollTop &&
        !isNearBottom(geometry, NATIVE_CHAT_FOLLOW_REARM_PX)
      ) {
        forwardedMovementRef.current = true
        expireForwardedScroll()
      } else if (geometry.scrollTop > previous.scrollTop) {
        invalidateForwardedGesture()
      }
      if (forwardedInputRef.current && forwardedMovementRef.current) {
        readerLeavesEnd()
      }
    },
    [
      clearForwardedScroll,
      expireForwardedScroll,
      forwardedInputRef,
      forwardedMovementRef,
      invalidateForwardedGesture,
      isAlignPending,
      readerLeavesEnd
    ]
  )

  const forwardedGesture = useCallback(
    (gesture: ReaderGesture) => {
      const element = scrollRef.current
      if (!followingRef.current || !isVisibleRef.current || !hasMeasurableViewport(element)) {
        clearForwardedScroll()
        return
      }
      if (gesture.kind !== 'touch-drag' && readerGestureDirection(gesture) >= 0) {
        invalidateForwardedGesture()
        return
      }
      forwardedInputRef.current = true
      expireForwardedScroll()
      if (
        forwardedMovementRef.current &&
        !isNearBottom(geometryOf(element), NATIVE_CHAT_FOLLOW_REARM_PX)
      ) {
        readerLeavesEnd()
      } else {
        forwardedMovementRef.current = false
        reconcileReaderScroll(true)
      }
    },
    [
      clearForwardedScroll,
      expireForwardedScroll,
      forwardedInputRef,
      forwardedMovementRef,
      invalidateForwardedGesture,
      readerLeavesEnd,
      reconcileReaderScroll,
      scrollRef
    ]
  )

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const element = scrollRef.current
      if (!isVisibleRef.current || !hasMeasurableViewport(element)) {
        return
      }
      const geometry = geometryOf(element)
      const programmatic = consumeProgrammaticScroll(event.nativeEvent, previousGeometryRef.current)
      observeForwardedMovement(geometry, programmatic)
      followingRef.current = nextFollowingEnd({
        following: followingRef.current,
        programmatic,
        geometry,
        previousDistanceFromEnd: previousDistanceFromEndRef.current,
        settling: isAlignPending()
      })
      reconcileReaderScroll(false)
      previousDistanceFromEndRef.current = distanceFromBottom(geometry)
      syncScrollState(geometry)
      if (readerReturn.readerReturned(geometry, programmatic)) {
        onReturnToEnd?.()
      }
    },
    [
      consumeProgrammaticScroll,
      isAlignPending,
      observeForwardedMovement,
      onReturnToEnd,
      readerReturn,
      reconcileReaderScroll,
      scrollRef,
      syncScrollState
    ]
  )

  const scrollToEndWhenMeasurable = useCallback(() => {
    if (isVisibleRef.current && hasMeasurableViewport(scrollRef.current)) {
      if (forwardedInputRef.current || forwardedMovementRef.current) {
        deferredPinRef.current = true
        return
      }
      clearForwardedScroll()
      performApplicationScroll(scrollToEnd)
    }
  }, [
    clearForwardedScroll,
    deferredPinRef,
    forwardedInputRef,
    forwardedMovementRef,
    performApplicationScroll,
    scrollRef,
    scrollToEnd
  ])

  const scrollToBottom = useCallback(
    (reason?: 'send') => {
      if (!isVisibleRef.current) {
        return
      }
      clearForwardedScroll()
      followingRef.current = true
      scrollToEndWhenMeasurable()
      setShowJump(false)
      onReturnToEnd?.(reason)
    },
    [clearForwardedScroll, onReturnToEnd, scrollToEndWhenMeasurable]
  )

  const scrollMessageToTop = useCallback(
    (element: HTMLElement, edge?: NativeChatAlignEdge) => {
      clearForwardedScroll()
      followingRef.current = false
      onLeaveEnd?.()
      alignToViewportTop(element, edge)
    },
    [alignToViewportTop, clearForwardedScroll, onLeaveEnd]
  )

  useNativeChatViewDisconnect(() => {
    previousIsVisibleRef.current = isVisibleRef.current = false
    observeVisibility(false, false)
  })

  useNativeChatVisibilityScroll({
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
  })

  useNativeChatTranscriptResize({
    scrollRef,
    contentRef,
    isVisibleRef,
    observeResize: readerReturn.observeResize,
    followingRef,
    scrollToEndWhenMeasurable,
    syncScrollState
  })

  return {
    showJump,
    recordReaderScroll: readerReturn.recordReaderScroll,
    onScroll,
    scrollToBottom,
    readerAtEnd: readerReturn.readerAtEnd,
    scrollMessageToTop,
    readerLeavesEnd,
    isFollowingEnd: readerReturn.isFollowingEnd,
    forwardedGesture
  }
}
