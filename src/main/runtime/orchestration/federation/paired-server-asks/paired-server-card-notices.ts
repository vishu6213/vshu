import type { VshuRuntimeService } from '../../../vshu-runtime'

/** A card came or went: the agents' Needs you and Home rows, and the chats showing cards, re-read.
 *  No ids: every agent's (a removal). */
export function notifyPairedServerCardsChanged(
  runtime: Pick<VshuRuntimeService, 'notifyBotsChanged'>,
  botIds?: readonly string[]
): void {
  runtime.notifyBotsChanged({ kinds: ['chats'], ...(botIds ? { botIds } : {}) })
}
