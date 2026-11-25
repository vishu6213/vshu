import { wslVshudVerifyRetryDelayMs } from './wsl-vshud-reconnect-backoff'
import type { WslVshudConnection } from './wsl-vshud-connection-types'
import type {
  Supervised,
  Trigger,
  WslVshudLivenessDependencies,
  WslVshudTimer
} from './wsl-vshud-liveness-state'
import type { WslVshudWatch } from './wsl-vshud-watch'

export function defaultSchedule(delayMs: number, task: () => void): WslVshudTimer {
  const timer = setTimeout(task, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/** `onChange(false)` on a real resume only: subscribing reports the current state at once. */
export function subscribeWake(
  subscribePower: WslVshudLivenessDependencies['subscribePower'],
  onChange: (suspended: boolean) => void
): () => void {
  let subscribed = false
  const unsubscribe = subscribePower?.({
    onSuspend: () => onChange(true),
    onResume: () => {
      if (subscribed) {
        onChange(false)
      }
    }
  })
  subscribed = true
  return unsubscribe ?? (() => {})
}

/** A backoff wait that `disarm` ends early through `wakeWait`. */
export function cancellableWait(
  entry: Supervised,
  schedule: (delayMs: number, task: () => void) => WslVshudTimer,
  delayMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    entry.wakeWait = resolve
    entry.timer = schedule(delayMs, resolve)
  }).finally(() => {
    entry.timer = null
    entry.wakeWait = null
  })
}

export async function ensureHolderQuietly(
  ensureHolder: WslVshudLivenessDependencies['ensureHolder'],
  distro: string
): Promise<void> {
  try {
    await ensureHolder?.(distro)
  } catch (error) {
    console.warn(`[wsl] holder re-ensure for ${distro} failed:`, error)
  }
}

/** A held watch that proves the port answers for it; a fresh one probes; a retired listener proves nothing. */
export async function probeVshudPort(
  entry: Supervised,
  connection: WslVshudConnection | null,
  attach: (connection: WslVshudConnection) => Promise<WslVshudWatch['signal']>
): Promise<WslVshudWatch['signal']> {
  if (!connection) {
    return 'refused'
  }
  return entry.watch?.proving() ? 'ready' : attach(connection)
}

/** While no watch proves vshud (no desktop socket open), a full verify runs this often instead. */
export const WSL_VSHUD_IDLE_VERIFY_MS = 30_000

/** The next liveness tick: the heartbeat while a watch proves vshud, a sooner full verify while none does. */
export function scheduleSupervisedHeartbeat(
  entry: Supervised,
  schedule: (delayMs: number, task: () => void) => WslVshudTimer,
  now: () => number,
  heartbeatMs: number,
  trigger: (trigger: Trigger) => void
): void {
  entry.timer?.cancel()
  entry.lastBeatMs = now()
  const delayMs = entry.watch?.proving()
    ? heartbeatMs
    : Math.min(heartbeatMs, WSL_VSHUD_IDLE_VERIFY_MS)
  entry.timer = schedule(delayMs, () => {
    entry.timer = null
    // Long-overdue ticks imply process/VM suspension; reverify all evidence.
    const late = now() - entry.lastBeatMs > delayMs * 2
    trigger(late ? { source: 'verify' } : 'heartbeat')
  })
}

/** Holds a new watch unless a later connect superseded this one or already holds one. */
export async function attachSupervisedWatch(
  entry: Supervised,
  openWatch: () => Promise<WslVshudWatch>,
  onExit: (code: number | null) => void,
  onIdle: () => void = () => {}
): Promise<WslVshudWatch['signal']> {
  const generation = entry.generation
  const watch = await openWatch()
  if (watch.signal !== 'ready') {
    return watch.signal
  }
  if (entry.generation !== generation || entry.watch) {
    watch.close()
    return 'ready'
  }
  entry.watch = watch
  watch.onExit((code) => {
    if (entry.watch === watch) {
      entry.watch = null
      onExit(code)
    }
  })
  watch.onIdle?.(() => {
    if (entry.watch === watch) {
      onIdle()
    }
  })
  return 'ready'
}

export function scheduleSupervisedVerify(
  entry: Supervised,
  schedule: (delayMs: number, task: () => void) => WslVshudTimer,
  verify: () => void
): void {
  entry.timer?.cancel()
  const delayMs = wslVshudVerifyRetryDelayMs(entry.verifyStreak)
  entry.verifyStreak += 1
  entry.timer = schedule(delayMs, () => {
    entry.timer = null
    verify()
  })
}
