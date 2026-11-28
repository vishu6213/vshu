import { useCallback, useRef } from 'react'

export function useNativeChatForwardedScroll() {
  const forwardedInputRef = useRef(false)
  const forwardedMovementRef = useRef(false)
  const deferredPinRef = useRef(false)
  const forwardedFrameRef = useRef<number | null>(null)

  const clearForwardedScroll = useCallback(() => {
    forwardedInputRef.current = false
    forwardedMovementRef.current = false
    deferredPinRef.current = false
    if (forwardedFrameRef.current !== null) {
      window.cancelAnimationFrame(forwardedFrameRef.current)
      forwardedFrameRef.current = null
    }
  }, [])

  const invalidateForwardedGesture = useCallback(() => {
    forwardedInputRef.current = false
    forwardedMovementRef.current = false
    // A cancelled gesture still owes the following reader any growth held for it.
    if (!deferredPinRef.current) {
      clearForwardedScroll()
    }
  }, [clearForwardedScroll])

  const expireForwardedScroll = useCallback(
    (onResumePin: () => void) => {
      if (forwardedFrameRef.current === null) {
        // A scroll and its cross-frame input report may arrive in either order.
        forwardedFrameRef.current = window.requestAnimationFrame(() => {
          forwardedFrameRef.current = window.requestAnimationFrame(() => {
            const resumePin = deferredPinRef.current
            clearForwardedScroll()
            if (resumePin) {
              onResumePin()
            }
          })
        })
      }
    },
    [clearForwardedScroll]
  )

  return {
    forwardedInputRef,
    forwardedMovementRef,
    deferredPinRef,
    clearForwardedScroll,
    invalidateForwardedGesture,
    expireForwardedScroll
  }
}
