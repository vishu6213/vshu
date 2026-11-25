import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess } from '@vshu/process-host'
import { VSHUD_LOG_FILENAME, VSHUD_READINESS_FILENAME } from './vshud-remote-host-support'
import { vshudLaunchCommand } from './vshud-remote-launch'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'

// Pairing tokens in readiness require owner-only launch artifacts even under login umask 022.

const posix = getRemoteHostPlatform('linux-x64')
const READY_LINE = '{"type":"vshu_server_ready","pairing":{"url":"vshu://pair#token"}}'

let home: string
let baseDir: string
let slotDir: string

function writeEntry(dir: string, before = ''): void {
  writeFileSync(join(dir, 'vshud.js'), `${before}console.log(${JSON.stringify(READY_LINE)})\n`)
}

describe.skipIf(process.platform === 'win32')('vshud launch file modes', () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'vshud-launch-modes-'))
    baseDir = join(home, '.vshu-remote')
    slotDir = join(baseDir, 'vshud-0.2.0+bb01')
    mkdirSync(slotDir, { recursive: true, mode: 0o755 })
    chmodSync(baseDir, 0o755)
    chmodSync(slotDir, 0o755)
    writeEntry(slotDir)
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  // Daemon children create user files and must retain login umask (#31125).

  // Artifact paths are relative to the slot, so a failed cd must not launch from the login cwd.
  it('creates nothing in the login directory when the slot is missing', async () => {
    rmSync(slotDir, { recursive: true, force: true })
    const command = vshudLaunchCommand(posix, {
      remoteInstallDir: slotDir,
      nodePath: process.execPath,
      fullVersion: '0.2.0+bb01',
      userDataDir: join(home, '.vshu'),
      bindHost: '127.0.0.1',
      port: 7777,
      activationRoot: join(baseDir, '.vshud-activation-transaction')
    })

    const result = await runProcess({
      program: '/bin/sh',
      args: ['-c', `cd ${quotePosixShell(home)}; ${command}`],
      timeoutMs: 10_000
    })

    expect(result.code).not.toBe(0)
    expect(existsSync(join(home, VSHUD_READINESS_FILENAME))).toBe(false)
    expect(existsSync(join(home, VSHUD_LOG_FILENAME))).toBe(false)
  })
})
