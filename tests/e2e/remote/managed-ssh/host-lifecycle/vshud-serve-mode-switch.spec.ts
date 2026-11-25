// D7: switch Electron serve ↔ vshud serve on one profile without replacing surviving daemon terminals; each host must refuse the other’s profile lock.
// Build pnpm build:vshud, then run electron-headless with VSHU_E2E_VSHUD_SERVE=1 VSHU_BACKGROUND_LAUNCH=1.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '@vshu/process-host'
import { getDaemonPidPath } from '../../../../../src/main/daemon/launch/daemon-spawner'
import { readDaemonPidRecord } from '../../../../../src/main/daemon/endpoint/identity/daemon-endpoint-incarnation'
import { resolveBundledVshudRuntime } from '../../../../../src/main/vshud/runtime-launch/vshud-bundled-runtime'
import '../../../../../src/main/vshud/serve-startup/vshud-configuration-exit'

import {
  buildDaemonSessionClient,
  type DaemonSessionClientResult
} from '../../../../../src/main/vshud/testing/daemon-processes/vshud-daemon-session-client-fixture'
import { test } from '../../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import '../../../desktop/daemon-lifecycle/daemon-generation-runtime-fixture'

import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from '../../paired-runtime/client-hosts/headless-paired-runtime-host'
import { cleanupE2EDaemons } from '../../../desktop/electron-fixtures/electron-process-shutdown'
import {
  cliServeProfile,
  isPidAlive,
  spawnUntilReady
} from '../../paired-runtime/client-hosts/vshu-serve-cli-host'

const RUN = process.env.VSHU_E2E_VSHUD_SERVE === '1'
const slotDir = path.resolve('out/vshud')
const vshudRuntime = RUN && existsSync(slotDir) ? resolveBundledVshudRuntime(slotDir) : null

test.describe.configure({ mode: 'serial' })

let scratch = ''
let clientScript = ''

test.beforeAll(async () => {
  test.skip(!RUN, 'Set VSHU_E2E_VSHUD_SERVE=1 (and build out/vshud) to run the serve mode switch.')
  expect(vshudRuntime, 'pnpm build:vshud must produce a packaged slot in out/vshud').toBeTruthy()
  // Short root: macOS caps a unix socket path at 104 bytes, and the daemon's lives in userData.
  scratch = mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'vshu-d7-'))
  clientScript = path.join(scratch, 'daemon-client.cjs')
  await buildDaemonSessionClient(clientScript)
})

test.afterAll(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
  }
})

function daemonPid(userDataDir: string): number | null {
  return readDaemonPidRecord(getDaemonPidPath(path.join(userDataDir, 'daemon')))?.pid ?? null
}

/** A paired client's terminal, straight to the profile's daemon, under this runner's Node. */
async function terminal(
  host: HeadlessPairedRuntimeHost,
  op: 'create' | 'attach',
  marker: string
): Promise<DaemonSessionClientResult> {
  const result = await runProcess({
    program: process.execPath,
    args: [clientScript, op, path.join(host.userDataDir, 'daemon'), 'serve-d7', marker, scratch],
    env: host.env,
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
}

type VshudServe = { daemonPid: number; stop: () => Promise<void> }

/** `vshu serve` on vshud, as the T6-11 launcher runs it, on the host's own profile. */
async function startVshudServe(
  host: Pick<HeadlessPairedRuntimeHost, 'env' | 'userDataDir'>
): Promise<VshudServe> {
  const serve = await spawnUntilReady({
    label: 'vshud serve',
    program: vshudRuntime!,
    args: [path.join(slotDir, 'vshud.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
    env: { ...host.env, VSHU_USER_DATA: host.userDataDir },
    timeoutMs: 120_000,
    parseReady: (stdout) => {
      const newline = stdout.indexOf('\n')
      return newline === -1 ? null : stdout.slice(0, newline)
    }
  })
  try {
    const daemon = JSON.parse(serve.ready).health?.terminalDaemon
    expect(daemon?.state, serve.stderr()).toBe('live')
    // POSIX: SIGTERM is vshud's graceful stop and leaves the daemon running by design.
    return { daemonPid: daemon.pid, stop: serve.stop }
  } catch (error) {
    // Why: the caller never gets stop(), and a leaked vshud keeps the profile lock.
    await serve.stop()
    throw error
  }
}

// Why: an SSH-managed vshud on this machine runs under ~/.vshu, beside the desktop's own profile.
test("Electron serve starts beside a live daemon another profile's vshud forked", async () => {
  const other = cliServeProfile(scratch)
  const vshud = await startVshudServe(other)
  try {
    const host = await launchHeadlessPairedRuntimeHost({
      pinnedServePort: true,
      userDataParent: scratch
    })
    try {
      expect(daemonPid(host.userDataDir)).not.toBe(vshud.daemonPid)
    } finally {
      await host.dispose()
    }
  } finally {
    await vshud.stop()
    await cleanupE2EDaemons(other.userDataDir)
  }
})

test('a terminal survives Electron serve → vshud serve → Electron serve on one profile', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    const created = await terminal(host, 'create', 'ELECTRON')
    expect(created).toMatchObject({ isReattach: false, output: true })
    const electronDaemon = daemonPid(host.userDataDir)
    expect(electronDaemon).toBeTruthy()

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Electron serve has quit; vshud serve takes the same profile and adopts its daemon.
        const vshud = await startVshudServe(host)
        try {
          expect(vshud.daemonPid).toBe(electronDaemon)
          expect(await terminal(host, 'attach', 'VSHUD')).toEqual({
            pid: created.pid,
            isReattach: true,
            output: true
          })
        } finally {
          await vshud.stop()
        }
      }
    })

    // Back on Electron serve: still the same daemon and the same live terminal.
    expect(daemonPid(host.userDataDir)).toBe(electronDaemon)
    expect(await terminal(host, 'attach', 'BACK')).toEqual({
      pid: created.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test("Electron serve adopts a terminal vshud's daemon owns", async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    let created: DaemonSessionClientResult | null = null
    let vshudDaemon: number | null = null
    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Retire Electron's daemon so vshud serve forks its own on the pinned Node.
        const previous = daemonPid(host.userDataDir)
        if (previous) {
          process.kill(previous, 'SIGKILL')
          await expect.poll(() => isPidAlive(previous), { timeout: 10_000 }).toBe(false)
        }
        const vshud = await startVshudServe(host)
        try {
          vshudDaemon = vshud.daemonPid
          expect(vshudDaemon).not.toBe(previous)
          created = await terminal(host, 'create', 'VSHUD')
          expect(created).toMatchObject({ isReattach: false, output: true })
        } finally {
          await vshud.stop()
        }
      }
    })
    expect(daemonPid(host.userDataDir)).toBe(vshudDaemon)
    expect(await terminal(host, 'attach', 'ELECTRON')).toEqual({
      pid: created!.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})
