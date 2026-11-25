/**
 * Lets a WSL distro stop once its vshud idle-stops with nothing left to keep (R40). The desktop's
 * holder keeps the distro up; it reads this request and ends after vshud's pid exits.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { VSHUD_WSL_HOLDER_RELEASE_FILENAME } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-idle-exit'
import { writeSecureFile } from '../../../shared/secure-storage/secure-file'
import { VSHUD_WSL_HOST_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-server-launch-env'
import type { VshudDaemonRetirement } from '../daemon/vshud-daemon-retirement'

export function vshudWslHolderReleasePath(userDataPath: string): string {
  return join(userDataPath, VSHUD_WSL_HOLDER_RELEASE_FILENAME)
}

/**
 * Only a WSL-host launch has a holder, and only a daemon that proved itself empty and left shows
 * no terminal would die with the distro. Why the launch marker: a setsid'd vshud may lack WSL_DISTRO_NAME.
 */
export function idleStopMayReleaseWslHolder(
  env: NodeJS.ProcessEnv,
  daemon: VshudDaemonRetirement
): boolean {
  return env[VSHUD_WSL_HOST_ENV] === '1' && daemon.retirement === 'retired'
}

export function requestVshudWslHolderRelease(userDataPath: string, pid = process.pid): void {
  writeSecureFile(vshudWslHolderReleasePath(userDataPath), `${pid}\n`)
}

/**
 * A starting vshud may be given work, so any earlier request no longer stands. WSL-host launches
 * only; never throws, so a locked or unwritable data root cannot fail a start or a stop.
 */
export function withdrawVshudWslHolderRelease(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env[VSHUD_WSL_HOST_ENV] !== '1') {
    return
  }
  try {
    rmSync(vshudWslHolderReleasePath(userDataPath), { force: true })
  } catch (error) {
    console.error('[vshud] could not withdraw the WSL holder release request:', error)
  }
}
