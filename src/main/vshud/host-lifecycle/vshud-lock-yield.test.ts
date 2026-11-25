import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../browser-providers/vshud-browser-startup', () => ({
  startVshudBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import {
  acquireVshudInstanceLock,
  VSHUD_LOCK_FILE_NAME
} from '../instance-lock/vshud-instance-lock'
import { readVshudInstanceLockRecord } from '../instance-lock/vshud-instance-lock-record'
import { installVshudShutdownSignals, startVshudWithHost } from './vshud-lifecycle'
import { VSHUD_LOCK_HEARTBEAT_MS } from '../instance-lock/vshud-lock-clone-machine'
import { vshudRunFailed } from './vshud-unexpected-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../../shared/app-lifecycle/launch/single-instance-exit-code'
import { _resetPendingWorktreeRemovalsForTests } from '../../workspaces/removal/worktree-background-removal'

const roots: string[] = []
afterEach(() => {
  // Drops the shutdown deadline timer so it cannot call the real process.exit later.
  vi.useRealTimers()
  vi.restoreAllMocks()
  _resetPendingWorktreeRemovalsForTests()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

// Counting a yield as a crash would feed the supervisor's crash-loop brake.
it('yields a lost instance lock to its new holder without counting a failed run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vshud-lock-yield-'))
  roots.push(root)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.spyOn(process, 'on').mockImplementation(() => process)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the code; nothing after process.exit runs here.
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const handle = await startVshudWithHost(
    root,
    async () => ({}),
    () => {}
  )
  installVshudShutdownSignals(() => handle.stop())
  const lockPath = join(root, VSHUD_LOCK_FILE_NAME)
  rmSync(lockPath)
  const successor = acquireVshudInstanceLock(root)

  vi.advanceTimersByTime(VSHUD_LOCK_HEARTBEAT_MS)
  await vi.waitFor(
    () => expect(exit).toHaveBeenCalledWith(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE),
    { interval: 1 }
  )
  expect(vshudRunFailed()).toBe(false)
  expect(readVshudInstanceLockRecord(lockPath)?.nonce).toBe(successor.record.nonce)
  successor.release()
})
