/** A slot this connect uploaded whose candidate then failed its start check is deleted, so the next connect re-uploads it instead of relaunching the same broken bytes. */
import { readVshudActivationRecord } from '../../managed-server/activation/vshud-activation-record-store'
import { vshudGcPinnedDirNames } from '../../managed-server/activation/vshud-activation-record'
import {
  probeVshudSlotReadiness,
  provenLiveDaemonVersion
} from '../../managed-server/lifecycle/vshud-managed-version-gc'
import { withVshudActivationLock } from '../../managed-server/activation/vshud-activation-lock'
import { removeRemoteInstallVersionDir } from '../../managed-server/install/remote-install-gc'
import {
  VSHUD_INSTALL_MODEL,
  remoteInstallDirName
} from '../../managed-server/install/remote-install-model'
import { readVshudGcTransactionPins } from '../../managed-server/activation/vshud-gc-transaction-pins'
import {
  vshudSlotDir,
  type VshudSlotOptions
} from '../../managed-server/activation/vshud-recovery-slot'
import type { VshudDeployResult } from '../../managed-server/install/vshud-remote-deploy'
import { isWslVshudSlotInUse } from './wsl-vshud-slot-process-probe'

export async function removeFailedFreshWslVshudInstall(
  slot: VshudSlotOptions,
  deployed: VshudDeployResult
): Promise<void> {
  if (
    deployed.outcome !== 'installed-not-activated' ||
    !deployed.startCheckFailed ||
    !deployed.freshlyInstalled
  ) {
    return
  }
  const version = deployed.fullVersion
  try {
    // Under the activation fence, so no activator can preflight or launch this slot meanwhile.
    const outcome = await withVshudActivationLock(
      slot,
      async () => {
        if (!(await mayRemove(slot, version))) {
          return 'pinned'
        }
        const removed = await removeRemoteInstallVersionDir(
          slot.conn,
          VSHUD_INSTALL_MODEL,
          vshudSlotDir(slot, version),
          slot.host,
          { isDirLive: (dir) => isWslVshudSlotInUse(slot, dir) }
        )
        return removed ? 'removed' : 'in-use'
      },
      () => 'fenced'
    )
    console.warn(
      outcome === 'removed'
        ? `[wsl-vshud] Removed vshud ${version}, which failed its start check after install.`
        : `[wsl-vshud] Kept failed vshud ${version} (${outcome}): it may still be in use.`
    )
  } catch (error) {
    // The connect already failed; a cleanup error must not replace its reason.
    console.warn(`[wsl-vshud] Could not remove failed vshud ${version}:`, error)
  }
}

/** The GC's pins: active, rollback target, the active daemon's build and any journaled slot. */
async function mayRemove(slot: VshudSlotOptions, version: string): Promise<boolean> {
  const dirName = remoteInstallDirName(VSHUD_INSTALL_MODEL, version)
  const record = await readVshudActivationRecord(slot)
  // Nothing active serves terminals; a daemon the rejected candidate left here is caught by the process probe.
  const liveDaemonVersion = record.active
    ? provenLiveDaemonVersion(await probeVshudSlotReadiness(slot, record.active))
    : null
  if (liveDaemonVersion === undefined) {
    return false
  }
  if (vshudGcPinnedDirNames(record, liveDaemonVersion).includes(dirName)) {
    return false
  }
  const transaction = await readVshudGcTransactionPins(slot, { callerHoldsFence: true })
  return transaction.state === 'pinned' && !transaction.dirNames.includes(dirName)
}
