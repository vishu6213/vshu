// #46567: an vshud that said it stopped idle stays down under visible work; a crash still relaunches.
import { describe, expect, it, vi } from 'vitest'
import { UNVERIFIABLE_VSHUD_TERMINAL_CENSUS } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { WslVshudConnection } from './wsl-vshud-connection-types'
import type { WslVshudConnectionStatus } from './wsl-vshud-connection-status'
import { WslVshudLivenessSupervisor } from './wsl-vshud-liveness-supervisor'

const DISTRO = 'Ubuntu'
// Settle, stopping-list and first-backoff waits fire at once; heartbeats and slow re-verifies never.
const FIRES_BELOW_MS = 30_000

function connection(pid: number): WslVshudConnection {
  return {
    distro: DISTRO,
    environmentId: 'wsl:ubuntu',
    localPort: 4000,
    remotePort: 5000,
    fullVersion: '1.0.0',
    pid,
    pairingOffer: '',
    deferredUpdate: null,
    close: async () => {}
  }
}

async function exitVshud(idleStopped: boolean) {
  let clock = 0
  let pid = 1
  let exitWatch: (code: number | null) => void = () => {}
  const published: WslVshudConnectionStatus['state'][] = []
  const launches: number[] = []
  let retired = false
  const supervisor = new WslVshudLivenessSupervisor({
    manager: {
      ensure: async () => {
        launches.push(pid)
        return connection(pid)
      },
      get: () => (retired ? null : connection(pid)),
      publish: (_distro, status) => published.push(status.state),
      close: async () => {},
      retireListener: async () => {
        retired = true
      }
    },
    readRunning: async () => ({ status: 'confirmed', distros: [DISTRO] }),
    // Same distro boot; vshud's pid changes once it exits.
    readIdentity: async () => ({ distroInstance: 'boot-1', vshud: `vshud-${pid}` }),
    openWatch: async () => ({
      signal: 'ready',
      onExit: (listener) => {
        exitWatch = listener
      },
      close: () => {},
      proving: () => true
    }),
    collectCensus: async () => UNVERIFIABLE_VSHUD_TERMINAL_CENSUS,
    wasIdleStopped: () => idleStopped,
    hasUserVisibleWork: () => true,
    deferUntilRunning: () => {},
    monotonicNow: () => clock,
    schedule: (delayMs, task) => {
      let cancelled = false
      if (delayMs < FIRES_BELOW_MS) {
        queueMicrotask(() => {
          if (!cancelled) {
            clock += delayMs
            task()
          }
        })
      }
      return { cancel: () => (cancelled = true) }
    },
    random: () => 0
  })
  await supervisor.connect(DISTRO)
  launches.length = 0
  pid = 2
  exitWatch(0)
  await vi.waitFor(() => expect(published.some((state) => state !== 'reconnecting')).toBe(true))
  await supervisor.dispose()
  return { published, launches }
}

describe('WSL liveness after vshud exits with its workspace still open', () => {
  it('leaves an idle-stopped vshud down', async () => {
    const { published, launches } = await exitVshud(true)
    expect(new Set(published)).toEqual(new Set(['idle']))
    expect(launches).toEqual([])
  })

  it('relaunches one that crashed', async () => {
    const { published, launches } = await exitVshud(false)
    expect(published).toEqual(['reconnecting', 'ready'])
    expect(launches).toEqual([2])
  })
})
