import { isVshuSessionId, type VshuSessionId } from './vshu-session-address'

/** A literal Vshu session id for a test, checked by the same predicate production uses. */
export function testVshuSessionId(id: string): VshuSessionId {
  if (!isVshuSessionId(id)) {
    throw new Error(`Not an Vshu session id: ${id}`)
  }
  return id
}
