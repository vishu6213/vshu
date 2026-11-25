import { EXIT_SETTLE_MS } from './wsl-vshud-liveness-evidence'
import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { SystemPowerLifecycleListener } from '../../power/system-power-lifecycle'
import type { WslRunningDistrosRead } from '../discovery/wsl-background-distro-gate'
import type { WslGuestIdentity } from '../execution/wsl-guest-process-identity'
import type { WslVshudConnection } from './wsl-vshud-connection-types'
import type { WslVshudConnectionManager } from './wsl-vshud-connection'
import type { WslVshudConnectionStatus } from './wsl-vshud-connection-status'
import type { WslLivenessEvidence, WslLivenessTrigger } from './wsl-vshud-liveness-verdict'
import type { WslVshudReconnectBackoff } from './wsl-vshud-reconnect-backoff'
import type { WslVshudWatch } from './wsl-vshud-watch'

/** A ready connection with a held watch re-reads only the running list this often. */
export const WSL_VSHUD_HEARTBEAT_MS = 120_000

export type WslVshudTimer = { cancel(): void }

export type WslVshudLivenessDependencies = {
  manager: Pick<
    WslVshudConnectionManager,
    'ensure' | 'get' | 'publish' | 'close' | 'retireListener'
  >
  /**
   * A settled read for `distro`: never a list probed while it may still be stopping (E9). With
   * `exitedAt`, also only a probe started once that exit's settle window has passed.
   */
  readRunning: (target: {
    distro: string
    exitedAt?: number | null
    /** Only a probe started at or after this instant (monotonic) may answer; a cached list won't. */
    probedAfter?: number
  }) => Promise<WslRunningDistrosRead>
  readIdentity: (distro: string, vshudPid: number | null) => Promise<WslGuestIdentity | null>
  openWatch: (connection: WslVshudConnection) => Promise<WslVshudWatch>
  collectCensus: (connection: WslVshudConnection) => Promise<VshudTerminalCensus>
  /** The distro's vshud closed its sockets saying it stopped idle (#46567). */
  wasIdleStopped?: (distro: string) => boolean
  /** A WSL project or terminal the user can see is open on this distro. */
  hasUserVisibleWork: (distro: string) => boolean | Promise<boolean>
  /** E9: recovery reconnects only into a distro confirmed running right before it spawns. */
  requireRunning?: (distro: string) => Promise<boolean>
  deferUntilRunning: (distro: string, key: string, task: () => unknown) => void
  /** C3's `ensureHeld`; called only while the distro is confirmed running, so it never boots. */
  ensureHolder?: (distro: string) => Promise<unknown>
  subscribePower?: (listener: SystemPowerLifecycleListener) => () => void
  monotonicNow?: () => number
  schedule?: (delayMs: number, task: () => void) => WslVshudTimer
  random?: () => number
  heartbeatMs?: number
}

export type Trigger = WslLivenessTrigger | 'heartbeat'

export type Supervised = {
  distro: string
  key: string
  generation: number
  expected: WslLivenessEvidence['expected']
  watch: WslVshudWatch | null
  timer: WslVshudTimer | null
  /** Ends a recovery's backoff wait early once the distro stops being supervised. */
  wakeWait: (() => void) | null
  backoff: WslVshudReconnectBackoff
  verifyStreak: number
  busy: boolean
  pending: Trigger | null
  state: WslVshudConnectionStatus['state'] | null
  lastBeatMs: number
  /** When a watch or holder last exited; a running list read soon after may still be stale. */
  lastExitMs: number | null
}

export function newSupervised(
  distro: string,
  key: string,
  nowMs: number,
  backoff: WslVshudReconnectBackoff
): Supervised {
  return {
    distro: distro.trim(),
    key,
    generation: 0,
    expected: { distroInstance: null, vshud: null },
    watch: null,
    timer: null,
    wakeWait: null,
    backoff,
    verifyStreak: 0,
    busy: false,
    pending: null,
    state: null,
    lastBeatMs: nowMs,
    lastExitMs: null
  }
}

/** Cancels the entry's timer and wake wait and closes its watch. */
export function disarmSupervised(entry: Supervised): void {
  entry.timer?.cancel()
  entry.timer = null
  entry.wakeWait?.()
  entry.wakeWait = null
  entry.watch?.close()
  entry.watch = null
}

// Covers the exit settle and the re-read after it, with room for a slow running-list read.
const EXIT_VERDICT_WINDOW_MS = EXIT_SETTLE_MS * 10

/**
 * A verdict is in progress, or the watch or holder just exited: a stopping distro can still be
 * listed as running, so a reconnect now could boot it again.
 */
export function isSupervisedSettling(entry: Supervised | undefined, nowMs: number): boolean {
  if (!entry) {
    return false
  }
  return (
    entry.busy ||
    entry.pending !== null ||
    (entry.lastExitMs !== null && nowMs - entry.lastExitMs < EXIT_VERDICT_WINDOW_MS)
  )
}

/** Any watch or holder exit, a clean one (code 0 from `wsl --shutdown`) included. */
export function isWatchOrHolderExit(trigger: Trigger): boolean {
  return trigger !== 'heartbeat' && trigger.source !== 'verify'
}

export function noteSupervisedExit(entry: Supervised, trigger: Trigger, nowMs: number): void {
  if (isWatchOrHolderExit(trigger)) {
    entry.lastExitMs = nowMs
    // An exit during a recovery backoff ends that recovery, so the exit re-reads the list now.
    if (entry.busy && entry.wakeWait) {
      entry.generation += 1
      entry.wakeWait()
    }
  }
}
