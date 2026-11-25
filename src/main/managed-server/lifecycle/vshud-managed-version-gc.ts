import type { NodeRuntimeTarget } from '../../../shared/node-runtime/node-runtime-pin'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import {
  vshudSlotDir,
  resolveVshudSlotIdentity,
  type VshudSlotOptions
} from '../activation/vshud-recovery-slot'
import { probeActiveVshudReadiness } from '../activation/vshud-active-readiness'
import { gcOldVshudVersions } from '../install/vshud-remote-gc'
import { nodeRuntimeStorePins } from '../install/pinned-runtime-host-target'

/** null proves no daemon; undefined means its version is unknown. */
export function provenLiveDaemonVersion(readiness: ServeReadiness): string | null | undefined {
  const daemon = readiness.health?.terminalDaemon
  if (daemon?.state === 'live' && daemon.buildVersion) {
    return daemon.buildVersion
  }
  return daemon?.state === 'absent' ? null : undefined
}

export type ManagedVshudPruneArgs = {
  slot: VshudSlotOptions
  serverTarget: NodeRuntimeTarget
  activeVersion: string
  readiness: ServeReadiness
  keepStagedWithinDays?: number
}

/** True only when GC ran and left no stale version dir behind. */
export async function pruneManagedVshudVersions(args: ManagedVshudPruneArgs): Promise<boolean> {
  const liveDaemonVersion = provenLiveDaemonVersion(args.readiness)
  // Unknown daemon versions could still execute from any candidate tree; skip GC.
  if (liveDaemonVersion === undefined) {
    return false
  }
  try {
    return await gcOldVshudVersions({
      conn: args.slot.conn,
      host: args.slot.host,
      remoteHome: args.slot.remoteHome,
      currentDirAbsPath: vshudSlotDir(args.slot, args.activeVersion),
      record: await readVshudActivationRecord(args.slot),
      liveDaemonVersion,
      // Default and compat builds share one runtime store.
      nodeRuntimePins: nodeRuntimeStorePins(args.serverTarget),
      ...(args.keepStagedWithinDays !== undefined
        ? { keepStagedWithinDays: args.keepStagedWithinDays }
        : {}),
      signal: args.slot.signal
    })
  } catch (error) {
    // Cleanup must not fail completed deploys; later connects retry.
    console.warn('[vshud-gc] Pruning old vshud versions failed:', error)
    return false
  }
}

/** GC otherwise runs only after an activation, so each deferred release left its staged slot behind (#34149). */
export async function pruneSupersededVshudCandidates(
  slot: VshudSlotOptions,
  serverTarget: NodeRuntimeTarget,
  candidateVersion: string
): Promise<void> {
  let readiness: ServeReadiness
  try {
    const active = (await readVshudActivationRecord(slot)).active
    if (!active) {
      return
    }
    readiness = await probeVshudSlotReadiness(slot, active)
  } catch (error) {
    // Without the incumbent's daemon version a staged tree may still be executing.
    console.warn('[vshud-gc] Skipped pruning staged vshud versions:', error)
    return
  }
  await pruneManagedVshudVersions({
    slot,
    serverTarget,
    activeVersion: candidateVersion,
    readiness,
    keepStagedWithinDays: STAGED_BUILD_KEEP_DAYS
  })
}

/** Readiness of the vshud serving `version`, which names its live terminal daemon's build. */
export async function probeVshudSlotReadiness(
  slot: VshudSlotOptions,
  version: string
): Promise<ServeReadiness> {
  const identity = await resolveVshudSlotIdentity(slot, version)
  return probeActiveVshudReadiness(
    { ...slot, remoteInstallDir: identity.remoteDir },
    { buildHash: identity.buildHash, fullVersion: identity.version }
  )
}

// Desktops on different releases share hosts; without a grace period each re-uploads what the other pruned.
const STAGED_BUILD_KEEP_DAYS = 3
