import type { WslRunningDistrosRead } from '../discovery/wsl-background-distro-gate'
import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import type { WslVshudLaunch } from './wsl-vshud-launch-contract'
import { confirmsRunning } from './wsl-vshud-liveness-evidence'

type WslVshudDeferredLaunch = Extract<WslVshudLaunch, { outcome: 'deferred' }>

/** vshud installed an update it may not activate yet (live terminals); nothing is listening. */
export class WslVshudLaunchDeferredError extends Error {
  constructor(readonly launch: WslVshudDeferredLaunch) {
    super(launch.reason)
    this.name = 'WslVshudLaunchDeferredError'
  }
}

/** A no-boot reconnect found the distro not confirmed running, so nothing was started. */
export class WslDistroNotRunningError extends Error {
  constructor(distro: string) {
    super(
      `The WSL distro ${distro} isn’t running, so Vshu didn’t start it for a background request.`
    )
    this.name = 'WslDistroNotRunningError'
  }
}

/** A no-boot gate couldn't read WSL's running list: nothing was started, and the verdict is open. */
export class WslDistroUnverifiableConnectError extends Error {
  constructor(distro: string) {
    super(
      `WSL didn’t answer whether ${distro} is running, so Vshu didn’t start anything there yet.`
    )
    this.name = 'WslDistroUnverifiableConnectError'
  }
}

/** True only for a confirmed running read; an unreadable list throws, never reading as "not running". */
export function requireConfirmedRunning(running: WslRunningDistrosRead, distro: string): boolean {
  if (running.status !== 'confirmed') {
    throw new WslDistroUnverifiableConnectError(distro)
  }
  return confirmsRunning(running, wslDistroHolderKey(distro))
}

export class WslVshudConnectionSupersededError extends Error {
  constructor(distro: string) {
    super(`The connection to the WSL distro ${distro} was closed while it was being opened.`)
    this.name = 'WslVshudConnectionSupersededError'
  }
}

/** A no-boot connect re-reads the running list just before anything spawns in the distro. */
export async function assertWslDistroMayStart(
  distro: string,
  requireRunning: ((distro: string) => Promise<boolean>) | undefined,
  isCurrent: () => boolean
): Promise<void> {
  if (!requireRunning) {
    return
  }
  const running = await requireRunning(distro)
  // A close during the read supersedes this connect before it deploys anything.
  if (!isCurrent()) {
    throw new WslVshudConnectionSupersededError(distro)
  }
  if (!running) {
    throw new WslDistroNotRunningError(distro)
  }
}

/** A no-boot gate refused before anything spawned: stopped, or the running list was unreadable. */
export function isNoBootRefusal(error: unknown): boolean {
  return (
    error instanceof WslDistroNotRunningError || error instanceof WslDistroUnverifiableConnectError
  )
}

/** Failures the connection's status must not report as `failed`: liveness owns those verdicts. */
export function isQuietConnectFailure(error: unknown): boolean {
  return error instanceof WslVshudConnectionSupersededError || isNoBootRefusal(error)
}
