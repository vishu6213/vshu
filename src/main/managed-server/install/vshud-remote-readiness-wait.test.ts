import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '@vshu/process-host'
import { vshudReadinessWaitCommand } from './vshud-remote-readiness-wait'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { VSHUD_LAUNCH_MACHINE_COMMAND } from './vshud-remote-host-support'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('the host-side readiness wait', () => {
  async function waitAfter(
    gone: boolean,
    machine: 'here' | 'elsewhere' | 'unrecorded',
    killPrefix = ''
  ) {
    const root = mkdtempSync(join(tmpdir(), 'vshud-readiness-wait-'))
    roots.push(root)
    const slot = join(root, 'slot')
    mkdirSync(slot)
    const pidFile = quotePosixShell(join(slot, '.vshud-pid'))
    const machineFile = quotePosixShell(join(slot, '.vshud-pid-machine'))
    const command = vshudReadinessWaitCommand(getRemoteHostPlatform('linux-x64'), slot, 2)
    const prefix = [
      killPrefix,
      gone ? `sh -c 'echo $$ > "$1"' vshud-test ${pidFile};` : `echo ${process.pid} > ${pidFile};`,
      ...(machine === 'here'
        ? [`{ ${VSHUD_LAUNCH_MACHINE_COMMAND};} > ${machineFile} 2>/dev/null;`]
        : machine === 'elsewhere'
          ? [`echo 'other-boot other-node' > ${machineFile};`]
          : [])
    ].join(' ')
    const { stdout } = await runProcess({
      program: '/bin/sh',
      args: ['-c', `${prefix} ${command}`],
      timeoutMs: 30_000
    })
    return stdout.startsWith('VSHUD_LAUNCH_EXITED\n')
  }

  // Only Linux has the boot id that makes a PID evidence; elsewhere the wait keeps its deadline.
  it.skipIf(process.platform !== 'linux')(
    'ends at once when the launched PID is gone here',
    async () => {
      expect(await waitAfter(true, 'here')).toBe(true)
    }
  )

  // zsh prints ESRCH lowercase (#34149).
  it.skipIf(process.platform !== 'linux')(
    'ends at once when kill reports the gone PID like zsh',
    async () => {
      const zshKill = 'kill() { echo "zsh:kill:1: kill 1 failed: no such process" >&2; return 1; };'
      expect(await waitAfter(true, 'here', zshKill)).toBe(true)
    }
  )

  it.each([
    ['waits while the launched PID still runs', false, 'here'],
    ['waits for a PID another machine sharing the home launched', true, 'elsewhere'],
    ['waits for a launch that recorded no machine', true, 'unrecorded']
  ] as const)('%s', async (_case, gone, machine) => {
    expect(await waitAfter(gone, machine)).toBe(false)
  })
})
