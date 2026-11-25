// Holding the lock means re-proving it on every heartbeat, not only at acquisition.
import { dirname, relative, isAbsolute } from 'node:path'
import { statSync, unlinkSync, utimesSync } from 'node:fs'
import { startVshudLockHeartbeat } from './vshud-lock-clone-machine'
import { readBoundedLockFile } from './vshud-instance-lock-reclaim'
import {
  describeLockHolder,
  parseVshudInstanceLockRecord,
  type VshudLockRecord
} from './vshud-instance-lock-record'
import type { VshudUnexpectedExit } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-unexpected-exit'

export type VshudInstanceLock = {
  readonly path: string
  readonly record: VshudLockRecord
  readonly previousUnexpectedExit: VshudUnexpectedExit | null
  /** `keepUnexpectedExit` puts back the crashed run's record this lock reclaimed, so the next
   * start still reports that run; for one-shot tools that must not consume the notice. */
  release(options?: { keepUnexpectedExit?: boolean }): void
}

const ownedProfileLocks = new Map<string, VshudLockRecord>()

export function ownsVshudProfileDirectory(directory: string): boolean {
  for (const [path, record] of ownedProfileLocks) {
    const child = relative(dirname(path), directory)
    if (child.startsWith('..') || isAbsolute(child)) {
      continue
    }
    const current = parseVshudInstanceLockRecord(readBoundedLockFile(path) ?? '')
    if (current?.nonce === record.nonce && current.pid === process.pid) {
      return true
    }
  }
  return false
}

type VshudLockBeat = 'held' | 'lost' | 'unproven'

function lockIsAbsent(lockPath: string): boolean {
  try {
    return !statSync(lockPath, { throwIfNoEntry: false })
  } catch {
    // Unstattable (e.g. a Windows delete-pending file) proves nothing; the next beat retries.
    return false
  }
}

/** Re-assert ownership: a removed lock lets the next starter in, so re-publish it or yield to its new holder. */
function beatVshudInstanceLock(
  lockPath: string,
  record: VshudLockRecord,
  publish: () => boolean
): VshudLockBeat {
  let current = readBoundedLockFile(lockPath)
  if (current === null && lockIsAbsent(lockPath)) {
    try {
      if (publish()) {
        console.warn(
          `[vshud] The instance lock ${lockPath} was removed while vshud ran; restored it.`
        )
        return 'held'
      }
    } catch (error) {
      console.warn('[vshud] could not restore the removed instance lock:', error)
      return 'unproven'
    }
    // Another starter published between the read and the restore.
    current = readBoundedLockFile(lockPath)
  }
  const holder = parseVshudInstanceLockRecord(current ?? '')
  if (!holder) {
    // Starters refuse unreadable records, and torn ones show up as a new holder by the next beat.
    console.warn(`[vshud] could not read the instance lock ${lockPath} to confirm ownership`)
    return 'unproven'
  }
  if (holder.nonce !== record.nonce) {
    console.error(
      `[vshud] ${describeLockHolder(holder)} (pid ${holder.pid}) took over the instance lock ` +
        `${lockPath}.`
    )
    return 'lost'
  }
  try {
    const now = new Date()
    utimesSync(lockPath, now, now)
  } catch (error) {
    // A stalled heartbeat lets a machine sharing this machine-id take the lock.
    console.warn('[vshud] could not refresh the instance lock heartbeat:', error)
  }
  return 'held'
}

export function holdVshudInstanceLock(
  lockPath: string,
  record: VshudLockRecord,
  publish: () => boolean,
  {
    previousUnexpectedExit,
    restoreReclaimedRecord,
    onExclusivityLost
  }: {
    previousUnexpectedExit: VshudUnexpectedExit | null
    /** Republishes the reclaimed record without overwriting a successor's lock. */
    restoreReclaimedRecord?: () => void
    onExclusivityLost: () => void
  }
): VshudInstanceLock {
  ownedProfileLocks.set(lockPath, record)
  let released = false
  const stopHeartbeat = startVshudLockHeartbeat(() => {
    if (beatVshudInstanceLock(lockPath, record, publish) === 'lost') {
      stopHeartbeat()
      onExclusivityLost()
    }
  })
  return {
    path: lockPath,
    record,
    previousUnexpectedExit,
    release: (options) => {
      if (released) {
        return
      }
      released = true
      if (ownedProfileLocks.get(lockPath)?.nonce === record.nonce) {
        ownedProfileLocks.delete(lockPath)
      }
      stopHeartbeat()
      // Re-read ownership before unlinking so a successor’s live runtime cannot be unlocked.
      const current = parseVshudInstanceLockRecord(readBoundedLockFile(lockPath) ?? '')
      if (!current || current.nonce !== record.nonce) {
        return
      }
      try {
        unlinkSync(lockPath)
      } catch {
        // Dead-PID leftovers can be reclaimed on the next start.
      }
      if (options?.keepUnexpectedExit && previousUnexpectedExit) {
        restoreReclaimedRecord?.()
      }
    }
  }
}
