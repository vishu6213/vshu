import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshudManagedStopContext } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'

export type VshudOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Request a mobile-scoped pairing offer and terminal QR. */
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  /** Print only the ephemeral-VM recipe line. */
  recipeJson?: boolean
  projectRoot?: string
  bind?: string
  /** Accept clients from public addresses, not only localhost, LAN and Tailscale. */
  allowPublic?: boolean
  /** Refuse public addresses even when grandfathered or otherwise accepted. */
  refusePublic?: boolean
  /** Slots have no browser client; vshu serve supplies the installed app client. */
  webClientRoot?: string
}

export type VshudHandle = {
  readiness: ServeReadiness
  managedStop: VshudManagedStopContext
  stop(): Promise<void>
}
