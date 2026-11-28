import { observeElementOffset, type VirtualizerOptions } from '@tanstack/react-virtual'

type ObserveOffset = VirtualizerOptions<HTMLDivElement, HTMLDivElement>['observeElementOffset']

export function observeNativeChatToolRunOffset(
  members: HTMLDivElement | null,
  instance: Parameters<ObserveOffset>[0],
  onOffset: Parameters<ObserveOffset>[1]
): ReturnType<ObserveOffset> {
  const viewport = instance.scrollElement
  if (!members || !viewport) {
    return
  }

  let pendingFrame: number | null = null
  let latestIsScrolling = false
  const flushOffset = (): void => {
    pendingFrame = null
    if (viewport.clientHeight > 0) {
      // The virtualizer uses member coordinates while the transcript owns the scrollbar.
      onOffset(
        viewport.getBoundingClientRect().top +
          viewport.clientTop -
          members.getBoundingClientRect().top,
        latestIsScrolling
      )
    }
  }
  const readOffset = (isScrolling: boolean): void => {
    latestIsScrolling = isScrolling
    if (pendingFrame === null) {
      pendingFrame = window.requestAnimationFrame(flushOffset)
    }
  }
  const stopScroll = observeElementOffset(instance, (_, isScrolling) => readOffset(isScrolling))
  flushOffset()
  if (typeof ResizeObserver === 'undefined') {
    return () => {
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame)
      }
      stopScroll?.()
    }
  }
  // Streaming or expanding earlier rows can move the run without a transcript scroll event.
  const observer = new ResizeObserver(() => readOffset(instance.isScrolling))
  for (let element: HTMLElement | null = members; element; element = element.parentElement) {
    observer.observe(element)
    if (element === viewport) {
      break
    }
  }
  return () => {
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame)
    }
    stopScroll?.()
    observer.disconnect()
  }
}
