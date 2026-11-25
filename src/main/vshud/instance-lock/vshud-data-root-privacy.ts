import { chmodSync, statSync } from 'node:fs'
import process from 'node:process'
import { restrictWindowsPathSync } from '../../../shared/secure-storage/secure-path-windows-acl'

type VshudInstanceLockCode =
  | 'vshud_data_root_unusable'
  | 'vshud_data_root_wrong_owner'
  | 'vshud_data_root_shared'
  | 'vshud_instance_lock_held'
  /** Shared-home/foreign-machine owners may still run and cannot be judged here. */
  | 'vshud_instance_lock_holder_unverifiable'
  | 'vshud_instance_lock_foreign_identity'
  | 'vshud_instance_lock_unreadable'

export class VshudInstanceLockError extends Error {
  constructor(
    readonly code: VshudInstanceLockCode,
    message: string
  ) {
    super(message)
    this.name = 'VshudInstanceLockError'
  }
}

export type VshudDataRootPrivacyHooks = {
  platform?: NodeJS.Platform
  restrictWindowsDataRoot?: (dataRoot: string) => boolean
}

/** Repair owned directory permissions before refusing: roots contain credentials and session state. */
export function assertVshudDataRootIsPrivate(
  dataRoot: string,
  hooks: VshudDataRootPrivacyHooks
): void {
  // Windows synthesizes POSIX mode bits; restrict and verify real ACLs instead.
  if ((hooks.platform ?? process.platform) === 'win32') {
    const restrict =
      hooks.restrictWindowsDataRoot ?? ((path: string) => restrictWindowsPathSync(path, true))
    if (!restrict(dataRoot)) {
      throw new VshudInstanceLockError(
        'vshud_data_root_shared',
        `Could not restrict the vshud data root ${dataRoot} to this user. vshud keeps ` +
          'private session and credential state there, so it refuses to start. Point VSHU_USER_DATA at a ' +
          'directory this account owns.'
      )
    }
    return
  }
  let stats
  try {
    stats = statSync(dataRoot)
  } catch (error) {
    throw new VshudInstanceLockError(
      'vshud_data_root_unusable',
      `Cannot stat the vshud data root ${dataRoot}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const uid = process.getuid?.()
  if (uid !== undefined && stats.uid !== uid) {
    throw new VshudInstanceLockError(
      'vshud_data_root_wrong_owner',
      `The vshud data root ${dataRoot} is owned by uid ${stats.uid}, not by uid ${uid} running ` +
        'this process. Give vshud its own data root (VSHU_USER_DATA) or chown this one.'
    )
  }
  if ((stats.mode & 0o077) === 0) {
    return
  }
  try {
    chmodSync(dataRoot, 0o700)
  } catch {
    // Re-stat to produce the actionable permission error.
  }
  let mode: number
  try {
    mode = statSync(dataRoot).mode
  } catch (error) {
    throw new VshudInstanceLockError(
      'vshud_data_root_unusable',
      `Cannot stat the vshud data root ${dataRoot}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if ((mode & 0o077) !== 0) {
    throw new VshudInstanceLockError(
      'vshud_data_root_shared',
      `The vshud data root ${dataRoot} is accessible to other users (mode ` +
        `${(mode & 0o777).toString(8)}) and could not be tightened. vshud keeps ` +
        'private session and credential state there, so it refuses to start. Run `chmod 700` on it, or point VSHU_USER_DATA ' +
        'at a private directory.'
    )
  }
}
