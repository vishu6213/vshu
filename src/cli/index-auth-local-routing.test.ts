import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveVshuAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveVshuAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/vshu-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime/client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveVshuAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/launch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  serveVshuApp: serveVshuAppMock
}))

vi.mock('./runtime/profile/metadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDefaultUserDataPath: getDefaultUserDataPathMock
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { okFixture } from './runtime/fixtures/runtime-rpc-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

const SIGNED_IN = { state: 'signed-in', email: 'a@example.test', storage: { kind: 'os-keychain' } }

function fakeLocalHost(): void {
  callMock.mockImplementation(async (method: string) => {
    switch (method) {
      case 'status.get':
        return okFixture('req', { capabilities: ['vshu-account.server-sign-in.v1'] })
      case 'vshuAccount.status':
      case 'vshuAccount.signOut':
        return okFixture('req', SIGNED_IN)
      case 'vshuAccount.signIn.start':
        return okFixture('req', {
          flowId: 'f',
          provider: 'sign-in',
          revision: 1,
          phase: 'starting'
        })
      case 'vshuAccount.signIn.wait':
        // Stop before the code prompt; routing is decided before any of this runs.
        return okFixture('req', {
          flowId: 'f',
          provider: 'sign-in',
          revision: 2,
          phase: 'failed',
          error: 'stop here'
        })
      default:
        throw new Error(`unexpected call ${method}`)
    }
  })
}

describe('`vshu auth` stays on this host', () => {
  const priorExitCode = process.exitCode
  afterEach(() => {
    process.exitCode = priorExitCode
    vi.unstubAllEnvs()
  })
  useWorktreeAwarenessEnvironment({
    callMock,
    serveVshuAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it.each(
    ['VSHU_ENVIRONMENT', 'VSHU_PAIRING_CODE', 'VSHU_REMOTE_PAIRING'].flatMap((variable) =>
      ['login', 'status', 'logout'].map((command) => [variable, command] as const)
    )
  )('ignores an ambient %s for `vshu auth %s`', async (variable, command) => {
    vi.stubEnv(variable, 'somewhere-else')
    fakeLocalHost()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    runtimeClientConstructorMock.mockClear()

    await main(['auth', command, '--json'], '/tmp/repo')

    expect(runtimeClientConstructorMock).toHaveBeenCalledWith(null, null)
    expect(runtimeClientConstructorMock).not.toHaveBeenCalledWith(undefined, undefined)
  })

  it.each(['--environment', '--pairing-code'])(
    'refuses an explicit %s before any account call',
    async (flag) => {
      fakeLocalHost()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(console, 'log').mockImplementation(() => {})

      await main(['auth', 'logout', flag, 'other', '--json'], '/tmp/repo')

      expect(callMock).not.toHaveBeenCalledWith('vshuAccount.signOut', undefined)
      expect(callMock.mock.calls.map(([method]) => method)).not.toContain('vshuAccount.signOut')
      expect(process.exitCode).toBe(1)
    }
  )
})
