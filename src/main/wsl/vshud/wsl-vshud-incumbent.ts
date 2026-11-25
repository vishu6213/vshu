/** E1: open a temporary bridge for incumbent census before activation. Unproven state is unverifiable, never zero; WSL has no standing deploy tunnel. */
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { VSHUD_MANAGED_REMOTE_PORT } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import {
  type VshudTerminalCensus,
  UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { ServeReadiness } from '../../server/serve-readiness'
import { probeActiveVshudReadiness } from '../../managed-server/activation/vshud-active-readiness'
import { vshudBoundPort } from '../../managed-server/lifecycle/vshud-managed-bound-port'
import { managedVshudInstallDir } from '../../managed-server/lifecycle/vshud-managed-runtime-context'
import { wakeStoppedManagedVshud } from '../../managed-server/lifecycle/vshud-managed-wake'
import type { VshudRemoteContext } from '../../managed-server/install/vshud-remote-context'
import type { VshudSlotOptions } from '../../managed-server/activation/vshud-recovery-slot'
import { readRemoteVshudBuildHash } from '../../managed-server/install/vshud-remote-build-hash'
import {
  requestVshudTerminalCensus,
  type VshudTerminalCensusRequestOptions
} from '../../managed-server/lifecycle/vshud-terminal-census-client'
import { updateTerminalCounts } from '../../managed-server/activation/vshud-fenced-stop'
import { tunneledVshudPairingCode } from '../../managed-server/lifecycle/vshud-tunneled-pairing'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'
import { listenWslVshudStdioBridge } from './wsl-vshud-stdio-bridge'

export type WslVshudIncumbent = {
  census: VshudTerminalCensus
  /** The incumbent's proven readiness; null when it could not be started or proven. */
  readiness: ServeReadiness | null
  /** Recount without wake and close terminal admission before activation stops the incumbent; unreadable never means zero. */
  recount: () => Promise<VshudTerminalCensus>
  /** Reopens the admission `recount` closed, when the incumbent keeps running. */
  releaseAdmission: () => Promise<void>
}

type IncumbentArgs = {
  context: VshudRemoteContext<WslVshudHostTarget>
  slot: VshudSlotOptions
  /** This desktop's enrolled pairing; null before its first pairing. */
  paired?: PairingOffer | null
}

const UNREADABLE: WslVshudIncumbent = {
  census: UNVERIFIABLE_VSHUD_TERMINAL_CENSUS,
  readiness: null,
  recount: async () => UNVERIFIABLE_VSHUD_TERMINAL_CENSUS,
  releaseAdmission: async () => {}
}

export type WslVshudIncumbentDependencies = {
  wake: typeof wakeStoppedManagedVshud
  probe: typeof probeActiveVshudReadiness
  readBuildHash: typeof readRemoteVshudBuildHash
  listen: (
    transport: VshudHostTransport,
    remotePort: number,
    target: WslVshudHostTarget
  ) => Promise<StartedPortForward>
  census: typeof requestVshudTerminalCensus
}

const DEFAULT_DEPENDENCIES: WslVshudIncumbentDependencies = {
  wake: wakeStoppedManagedVshud,
  probe: probeActiveVshudReadiness,
  readBuildHash: readRemoteVshudBuildHash,
  listen: (transport, remotePort, target) =>
    listenWslVshudStdioBridge(transport, {
      environmentId: target.id,
      distro: target.distro,
      remotePort,
      localPort: 0,
      label: `Vshu server in WSL: ${target.label} (update check)`
    }),
  census: requestVshudTerminalCensus
}

/** Wake reboot/idle-stopped incumbent, census its daemon, then close the temporary bridge before returning. */
export async function readWslVshudIncumbent(
  args: IncumbentArgs,
  dependencies: WslVshudIncumbentDependencies = DEFAULT_DEPENDENCIES
): Promise<WslVshudIncumbent> {
  const record = args.context.activationRecord
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!record.active || !Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNREADABLE
  }
  let readiness: ServeReadiness
  try {
    const wake = await dependencies.wake(args.slot)
    if (wake.outcome === 'started') {
      readiness = wake.readiness
    } else if (wake.outcome === 'serving') {
      const remoteInstallDir = managedVshudInstallDir(args.context, record.active)
      readiness = await dependencies.probe(
        { ...args.slot, remoteInstallDir },
        {
          buildHash: await dependencies.readBuildHash(args.slot, remoteInstallDir),
          fullVersion: record.active
        }
      )
    } else {
      return UNREADABLE
    }
  } catch {
    return UNREADABLE
  }
  const counts = updateTerminalCounts((options) =>
    countIncumbentTerminals(args, readiness, activatedAt, dependencies, options)
  )
  return {
    census: await counts.countFirst(),
    readiness,
    recount: counts.recountCensus,
    releaseAdmission: counts.releaseIncumbentAdmission
  }
}

async function countIncumbentTerminals(
  args: IncumbentArgs,
  readiness: ServeReadiness,
  activatedAt: number,
  dependencies: WslVshudIncumbentDependencies,
  options: VshudTerminalCensusRequestOptions
): Promise<VshudTerminalCensus> {
  let forward: StartedPortForward | null = null
  try {
    forward = await dependencies.listen(
      args.slot.conn,
      vshudBoundPort(readiness) ?? VSHUD_MANAGED_REMOTE_PORT,
      args.context.target
    )
    // Use enrolled grants; startup offers would enroll a fresh device on every census.
    const offer = parsePairingCode(
      tunneledVshudPairingCode(readiness, forward.entry.localPort, args.paired)
    )
    if (!offer) {
      return UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
    }
    return await dependencies.census(
      pairedRuntimeConnectionFromOffer(offer),
      activatedAt,
      undefined,
      options
    )
  } catch {
    return UNVERIFIABLE_VSHUD_TERMINAL_CENSUS
  } finally {
    await forward?.close().catch(() => {})
  }
}
