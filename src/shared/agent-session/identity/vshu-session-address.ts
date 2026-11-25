import { isAgentSessionId } from '../lifecycle/agent-session-record'
import { isTerminalHandle } from '../../terminal/terminal-handle-prefix'
import { VSHU_SESSION_ADDRESS_PREFIX } from './vshu-session-address-prefix'

/** Vshu-minted structured session identity (record id/VSHU_AGENT_SESSION_ID), never provider identity. Orchestration stores bare lineage-root ids after /clear,
 * not live replacement ids; derive mail spelling vshu_session_id:<id> alongside run:/dispatch: addresses.
 * Resolve execution location from records. PTYs have no id today; never use pane keys because later agents inherit panes. */

declare const vshuSessionIdBrand: unique symbol
declare const vshuSessionAddressBrand: unique symbol

/** A bare Vshu session id; only `isVshuSessionId` and `parseVshuSessionAddress` produce one. */
export type VshuSessionId = string & { readonly [vshuSessionIdBrand]: true }
/** An `vshu_session_id:<id>` mail address; only `formatVshuSessionAddress` produces one. */
export type VshuSessionAddress = string & { readonly [vshuSessionAddressBrand]: true }

export function isVshuSessionId(id: string): id is VshuSessionId {
  return isAgentSessionId(id) && !isTerminalHandle(id)
}

/** A plain random UUID; the agent is on the record, never in the ID. */
export function createVshuSessionId(randomUuid: () => string): VshuSessionId {
  const id = randomUuid()
  // Always true for a UUID; the check brands the id without a type assertion.
  if (!isVshuSessionId(id)) {
    throw new Error(`Not a Vshu session id: ${id}`)
  }
  return id
}

export function formatVshuSessionAddress(vshuSessionId: VshuSessionId): VshuSessionAddress {
  const address = `${VSHU_SESSION_ADDRESS_PREFIX}${vshuSessionId}`
  // Always true for a checked id; the check brands the address without a type assertion.
  if (!isVshuSessionAddress(address)) {
    throw new Error(`Not a Vshu session id: ${vshuSessionId}`)
  }
  return address
}

/** The bare Vshu session id of an `vshu_session_id:<id>` address; anything else reads as null. */
export function parseVshuSessionAddress(address: string | null | undefined): VshuSessionId | null {
  if (!address?.startsWith(VSHU_SESSION_ADDRESS_PREFIX)) {
    return null
  }
  const id = address.slice(VSHU_SESSION_ADDRESS_PREFIX.length)
  return isVshuSessionId(id) ? id : null
}

function isVshuSessionAddress(address: string): address is VshuSessionAddress {
  return parseVshuSessionAddress(address) !== null
}
