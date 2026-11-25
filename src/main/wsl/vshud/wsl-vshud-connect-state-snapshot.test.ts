import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { runProcess } from '@vshu/process-host'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  emptyVshudActivationRecord,
  serializeVshudActivationRecord,
  withActivatedVersion
} from '../../managed-server/activation/vshud-activation-record'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import {
  createWslVshudConnectStateReader,
  parseWslVshudConnectState,
  wslVshudConnectStateHints
} from './wsl-vshud-connect-state-snapshot'

const mockExec = vi.mocked(execCommand)
const host = getRemoteHostPlatform('linux-x64')
const ACTIVE = withActivatedVersion(
  emptyVshudActivationRecord(),
  '0.1.0+aa01',
  null,
  new Date('2026-02-02T00:00:00.000Z')
)
let home: string

function target() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand is mocked, so the transport is never used.
  const conn = Object.create(null) as VshudHostTransport
  return { conn, host, remoteHome: home, userDataDir: join(home, '.vshu') }
}

function write(relative: string, content: string): void {
  const path = join(home, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vshu-wsl-connect-state-'))
  mockExec.mockReset()
  mockExec.mockImplementation(async (_conn, command) => {
    const result = await runProcess({ program: '/bin/sh', args: ['-c', command] })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout
  })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('WSL connect state snapshot fallbacks', () => {
  it('falls back to the plain read when the snapshot command itself fails', async () => {
    write('.vshu-remote/vshud-active.json', serializeVshudActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(async () => {
      throw new Error('transport closed')
    })
    const reader = createWslVshudConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)
    expect(reader.snapshot()).toBeNull()
  })

  it('gives no hints when only the fallback read could answer the record', async () => {
    write('.vshu-remote/vshud-active.json', serializeVshudActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(
      async () =>
        'UNREADABLE\n__VSHU_WSL_CONNECT_STATE_END__\nABSENT\n__VSHU_WSL_CONNECT_STATE_END__\n' +
        'ABSENT\n__VSHU_WSL_CONNECT_STATE_END__\nNONE\n__VSHU_WSL_CONNECT_STATE_END__\nOPEN\n'
    )
    const reader = createWslVshudConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)
    expect(reader.snapshot()).toBeNull()
  })
})

describe('parseWslVshudConnectState', () => {
  const end = '\n__VSHU_WSL_CONNECT_STATE_END__\n'
  const stat = (pid: number) =>
    `${pid} (node) S ${Array.from({ length: 18 }, () => '0').join(' ')} 77 0`
  const identity = (pid: number) =>
    `PID ${pid}\n0f6e1d2c-3b4a-4958-8776-655443322110\n--vshu-identity--\n${stat(1)}\n` +
    `--vshu-identity--\n${stat(pid)}\n--vshu-identity--\n`
  const answer = (holder: string) =>
    `ABSENT${end}ABSENT${end}PRESENT\n{"pid":9}${end}${holder}${end}OPEN\n`

  it('attaches the holder identity to a present lock, and nothing it cannot parse', () => {
    const lock = parseWslVshudConnectState(answer(identity(9)))?.instanceLock
    expect(lock).toMatchObject({ state: 'present', holder: { pid: 9, guest: { vshud: '9:77' } } })
    expect(parseWslVshudConnectState(answer('NONE'))?.instanceLock).toEqual({
      state: 'present',
      raw: '{"pid":9}'
    })
    expect(parseWslVshudConnectState(answer('PID 9\nnoise'))?.instanceLock).not.toHaveProperty(
      'holder'
    )
  })

  it('rejects a truncated answer', () => {
    expect(parseWslVshudConnectState('ABSENT\n__VSHU_WSL_CONNECT_STATE_END__\n')).toBeNull()
  })
})

describe('wslVshudConnectStateHints', () => {
  const snapshot = {
    activation: { state: 'ok' as const, record: ACTIVE },
    transactionAbsent: true,
    instanceLock: { state: 'absent' as const },
    fenceOpen: true
  }

  it('stops hinting once recovery, adoption or admission replaced the record', () => {
    const hints = wslVshudConnectStateHints(snapshot, ACTIVE)
    const replaced = { ...ACTIVE }
    expect(hints.instanceLock(replaced)).toBeUndefined()
    expect(hints.deployPreRead(replaced)).toEqual({})
  })
})
