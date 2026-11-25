import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type {
  WslHostAddStage,
  WslHostDeferredUpdate,
  WslHostPastUncountedTerminals
} from '../../../shared/remote-runtime/wsl-hosts/wsl-host-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import type { InstallLockWait } from '../../managed-server/install/remote-install-lock'
import type { VshudUpdateIntent } from '../../managed-server/lifecycle/vshud-managed-update-decision'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'
import type { readWslVshudIncumbent } from './wsl-vshud-incumbent'

export type WslVshudLaunch =
  | {
      outcome: 'ready'
      distro: string
      /** The Lxss registration GUID for the deployment record's `distroId`; null if unreadable. */
      distroId: string | null
      /** The loopback port vshud bound inside the distro (another one when the preferred was taken). */
      port: number
      fullVersion: string
      pid: number | null
      readiness: ServeReadiness
      holder: 'adopted' | 'spawned' | 'unverifiable'
      /** An vshud the record did not name (e.g. left by a failed Remove), now recorded. */
      adoptedInstance?: { version: string; pid: number }
      /** Set when `fullVersion` is the incumbent because the update must wait. */
      deferredUpdate?: WslHostDeferredUpdate
    }
  | ({ outcome: 'deferred'; distro: string } & WslHostDeferredUpdate)

export type WslVshudDeployOptions = {
  /** The WSL environment's id; keys host-scoped state (wake dedupe). Defaults per distro. */
  environmentId?: string
  label?: string
  /** Defaults to a connect. */
  intent?: VshudUpdateIntent
  /** With intent `update`: force past an uncounted census, but only over this confirmed build. */
  pastUncountedTerminals?: WslHostPastUncountedTerminals
  signal?: AbortSignal
  /** Defaults to one created over `userData`; the app should pass its shared instance. */
  holder?: WslDistroHolder
  createTransport?: (target: WslVshudHostTarget) => VshudHostTransport & { dispose?(): void }
  readRegistryId?: (distro: string) => Promise<string | null>
  readIncumbent?: typeof readWslVshudIncumbent
  /** This desktop's enrolled pairing, which the incumbent's terminal count authenticates with. */
  pairedOffer?: PairingOffer | null
  /** The vshud template to deploy from; defaults to the packaged one (the C10 lane swaps it). */
  templateDir?: string
  /** A no-boot connect's running check (E9), re-read before any further wake. */
  requireRunning?: () => Promise<boolean>
  onInstallLockWait?: (wait: InstallLockWait | null) => void
  /** Each step of the launch as it starts, for an Add's progress. */
  onStage?: (stage: WslHostAddStage) => void
}
