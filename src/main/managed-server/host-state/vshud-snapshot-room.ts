/** Check snapshot room before stopping a serving incumbent (#30491). */
import { vshudRemoteBaseDir } from '../install/vshud-remote-windows-node'
import { execVshudRemoteOr } from '../install/vshud-remote-runtime-control'
import {
  VSHUD_STATE_SNAPSHOT_DIR,
  type VshudActivationRecord
} from '../activation/vshud-activation-record'
import {
  vshudSnapshotShortfallKb,
  vshudSnapshotShortfallMessage,
  vshudSnapshotSpaceCommand,
  parseVshudSnapshotSpace
} from './vshud-state-snapshot-space'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import type { VshudSlotOptions } from '../activation/vshud-recovery-slot'

export const VSHUD_SNAPSHOT_SPACE_INSUFFICIENT_CODE = 'vshud_snapshot_space_insufficient'

export function vshudSnapshotsRoot(options: Pick<VshudSlotOptions, 'host' | 'remoteHome'>): string {
  return joinRemotePath(
    options.host,
    vshudRemoteBaseDir(options.host, options.remoteHome),
    VSHUD_STATE_SNAPSHOT_DIR
  )
}

/** Unknown room proceeds to authoritative capture; return a refusal only for proven insufficient space. */
export async function vshudSnapshotRoomRefusal(
  options: VshudSlotOptions,
  record: VshudActivationRecord,
  fullVersion: string
): Promise<string | null> {
  const baseDir = vshudRemoteBaseDir(options.host, options.remoteHome)
  const command = vshudSnapshotSpaceCommand(
    options.host,
    options.userDataDir,
    vshudSnapshotsRoot(options),
    baseDir,
    record.snapshot ? [record.snapshot.dirName] : []
  )
  if (!command) {
    return null
  }
  const space = parseVshudSnapshotSpace(await measureRoom(options, command))
  const shortfall = vshudSnapshotShortfallKb(space)
  return space && shortfall !== null
    ? vshudSnapshotShortfallMessage(space, shortfall, {
        userDataDir: options.userDataDir,
        baseDir,
        fullVersion,
        active: record.active
      })
    : null
}

async function measureRoom(options: VshudSlotOptions, command: string): Promise<string> {
  try {
    return await execVshudRemoteOr(options, command)
  } catch (error) {
    // Unconfirmed read-only cleanup leaves room unknown; capture decides, unless caller cancelled.
    if (isUnconfirmedSshCommandTermination(error) && !options.signal?.aborted) {
      return ''
    }
    throw error
  }
}
