import process from 'node:process'
import { profileStateAccessMachineIdentity } from '../../persistence/profile-state/access/profile-state-access-identity'
import { readVshudProcessIncarnation } from './vshud-process-start-time'
import { VshudInstanceLockError } from './vshud-data-root-privacy'
import { vshudCloneMachineHint, vshudPeerIsLiveCloneMachine } from './vshud-lock-clone-machine'
import {
  vshudStaleLockReclaimCommand,
  type VshudReclaimHintRuntime
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stale-lock-reclaim'

/** Match machine identity, then legacy boot identity; identity-less records require local-only storage. */
export function vshudLockHolderLocality(
  holder: VshudPeerMachine,
  self: VshudPeerMachine,
  dataRootIsOnLocalDisk: () => boolean,
  platform: NodeJS.Platform = process.platform
): 'local' | 'foreign' | 'unknown' {
  if (holder.machineIdentity && self.machineIdentity) {
    if (holder.machineIdentity !== self.machineIdentity) {
      return 'foreign'
    }
    return vshudPeerIsLiveCloneMachine(holder, self, dataRootIsOnLocalDisk, platform)
      ? 'unknown'
      : 'local'
  }
  if (holder.bootId && holder.bootId === self.bootId) {
    return 'local'
  }
  return dataRootIsOnLocalDisk() ? 'local' : 'unknown'
}

export type VshudPeerMachine = {
  machineIdentity?: string
  bootId?: string
  /** Latest of the record's own timestamp and its heartbeat mtime. */
  writtenAtMs?: number
  bootStartedAtMs?: number
  nowMs?: number
}

export function currentVshudPeerMachine(): VshudPeerMachine {
  const machineIdentity = profileStateAccessMachineIdentity()
  const bootId = readVshudProcessIncarnation(process.pid)?.bootId
  return { ...(machineIdentity ? { machineIdentity } : {}), ...(bootId ? { bootId } : {}) }
}

/** PIDs require a provable machine and boot match; unknown peers are never assumed exited. */
export function vshudPeerPidIsJudgeableHere(
  peer: VshudPeerMachine,
  self: VshudPeerMachine,
  dataRootIsOnLocalDisk: () => boolean
): boolean {
  if (peer.bootId && self.bootId && peer.bootId !== self.bootId) {
    return false
  }
  return vshudLockHolderLocality(peer, self, dataRootIsOnLocalDisk) === 'local'
}

export function vshudLockHolderUnverifiableError(lock: {
  holder: string
  foreign: boolean
  /** The holder runs on another machine that reports this machine-id. */
  cloneMachine?: { role: 'vshud' | 'desktop' }
  dataRoot: string
  lockPath: string
  /** Managed hosts may lack launchers on PATH, so name this runtime/entry in reclaim hints. */
  hintRuntime: VshudReclaimHintRuntime | null
}): VshudInstanceLockError {
  const command = vshudStaleLockReclaimCommand(lock.dataRoot, lock.hintRuntime)
  const reclaim =
    process.platform === 'linux'
      ? `run \`${command}\` on the machine it ran on to check and clear it, or `
      : ''
  const cloneHint = lock.cloneMachine ? ` ${vshudCloneMachineHint(lock.cloneMachine.role)}` : ''
  return new VshudInstanceLockError(
    'vshud_instance_lock_holder_unverifiable',
    `${lock.holder} holds the data root ${lock.dataRoot}${lock.foreign || lock.cloneMachine ? ' from another machine' : ''}. ` +
      'Vshu cannot check from here whether it is still running, because this data root may be ' +
      `shared with other machines. Stop it there. If it is not running anywhere, ${reclaim}` +
      `delete ${lock.lockPath} once you are sure.${cloneHint}`
  )
}
