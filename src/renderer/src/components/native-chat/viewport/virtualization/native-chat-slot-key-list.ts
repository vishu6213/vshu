import type { MutableRefObject } from 'react'
import { nativeChatSlotKey } from '../../conversation/slots/native-chat-transcript-slot-selection'
import type { NativeChatTranscriptSlot } from '../../conversation/slots/native-chat-transcript-slots'

/** Reuse the previous slot-key array whenever keys are unchanged so virtualizer state stays stable. */
export function resolveStableNativeChatSlotKeys(
  prevItemKeysRef: MutableRefObject<string[]>,
  slots: readonly NativeChatTranscriptSlot[]
): string[] {
  const previous = prevItemKeysRef.current
  const nextKeys = slots.map(nativeChatSlotKey)
  if (
    previous.length === nextKeys.length &&
    nextKeys.every((key, index) => key === previous[index])
  ) {
    return previous
  }
  prevItemKeysRef.current = nextKeys
  return nextKeys
}
