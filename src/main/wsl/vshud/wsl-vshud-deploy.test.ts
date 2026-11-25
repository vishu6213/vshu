import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VshudHostTransport } from '../../managed-server/install/vshud-host-transport'
import type * as ActiveProbe from './wsl-vshud-active-probe'
import type * as ManagedRuntimeContext from '../../managed-server/lifecycle/vshud-managed-runtime-context'
import type * as RemoteVersionedInstall from '../../managed-server/install/remote-versioned-install'
import { emptyVshudActivationRecord } from '../../managed-server/activation/vshud-activation-record'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { VshudActiveReadinessError } from '../../managed-server/activation/vshud-active-readiness'
import { WslDistroNotRunningError } from './wsl-vshud-connection-errors'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import type { WslVshudHostTarget } from './wsl-vshud-host-target'

const mocks = vi.hoisted(() => ({
  steps: new Array<string>(),
  exec: vi.fn(),
  resolveContext: vi.fn(),
  recover: vi.fn(),
  deploy: vi.fn(),
  probe: vi.fn(),
  prune: vi.fn(),
  wake: vi.fn(),
  adopt: vi.fn(),
  incumbent: vi.fn(),
  adoptRunning: vi.fn(),
  localVersion: vi.fn(),
  readRecord: vi.fn(),
  removeFailed: vi.fn(),
  transaction: vi.fn(async (): Promise<unknown> => null)
}))
vi.mock('./wsl-vshud-failed-install-removal', () => ({
  removeFailedFreshWslVshudInstall: mocks.removeFailed
}))
vi.mock('../../managed-server/activation/vshud-activation-transaction-store', () => ({
  readVshudActivationTransaction: mocks.transaction
}))
vi.mock('../../managed-server/activation/vshud-activation-record-store', () => ({
  readVshudActivationRecord: mocks.readRecord,
  vshudActivationPath: (_host: unknown, home: string) => `${home}/.vshu-remote/vshud-active.json`
}))
vi.mock('../../managed-server/install/remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<typeof RemoteVersionedInstall>()),
  readLocalFullVersion: mocks.localVersion
}))
vi.mock('./wsl-vshud-instance-adoption', () => ({ adoptUnrecordedWslVshud: mocks.adopt }))
vi.mock('../../managed-server/activation/vshud-running-version-adoption', () => ({
  adoptRunningVshudVersion: mocks.adoptRunning
}))

vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getVersion: () => '1.5.0', getPath: () => '/user-data' })
}))
vi.mock('../../ssh/remote-exec/remote-exec-command', () => ({ execCommand: mocks.exec }))
vi.mock('../../managed-server/install/vshud-remote-context', () => ({
  resolveVshudRemoteContext: mocks.resolveContext
}))
vi.mock('../../managed-server/activation/vshud-activation-recovery', () => ({
  recoverInterruptedVshudActivation: mocks.recover
}))
vi.mock('../../vshud/artifact-slots/vshud-artifact-materializer', () => ({
  materializeVshudArtifact: async () => '/local/vshud'
}))
vi.mock('../../managed-server/install/vshud-remote-deploy', () => ({ deployVshud: mocks.deploy }))
vi.mock('./wsl-vshud-active-probe', async (importOriginal) => ({
  ...(await importOriginal<typeof ActiveProbe>()),
  probeWslActiveVshud: async (...args: unknown[]) => ({
    readiness: await mocks.probe(...args),
    pid: 4242
  })
}))
vi.mock('../../managed-server/lifecycle/vshud-managed-version-gc', () => ({
  provenLiveDaemonVersion: () => null,
  pruneManagedVshudVersions: mocks.prune,
  pruneSupersededVshudCandidates: async () => {}
}))
vi.mock('../../managed-server/lifecycle/vshud-managed-wake', () => ({
  wakeStoppedManagedVshud: mocks.wake
}))
vi.mock('../../managed-server/lifecycle/vshud-managed-runtime-context', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedRuntimeContext>()),
  probeManagedVshudReadiness: mocks.probe
}))

import { deployAndLaunchWslVshud } from './wsl-vshud-deploy'
import { resetVshudUpdateFailuresForTests } from '../../managed-server/lifecycle/vshud-managed-update-failure-memory'

beforeEach(() => resetVshudUpdateFailuresForTests())

const host = getRemoteHostPlatform('linux-x64')
const READINESS = {
  runtimeId: 'r1',
  boundEndpoint: 'ws://127.0.0.1:6790',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled' as const,
  pairing: { available: false as const, reason: 'disabled_by_operator', guidance: '' }
}

function holder(): WslDistroHolder {
  return {
    ensureHeld: vi.fn(async (distro: string) => {
      mocks.steps.push(`hold:${distro}`)
      return {
        outcome: 'spawned' as const,
        record: { version: 1 as const, distro, pid: 9, creationTimeMs: 1, startedAtMs: 1 }
      }
    }),
    adoptHolders: vi.fn(),
    release: vi.fn(),
    releaseAll: vi.fn(),
    holderState: vi.fn()
  }
}

function transport(target: WslVshudHostTarget): VshudHostTransport {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every host call is mocked at its module.
  return { getTarget: () => target } as unknown as VshudHostTransport
}
let snapshotAnswer = ''

function launch(kernel = '5.15.167.4-microsoft-standard-WSL2', options = {}) {
  mocks.exec.mockImplementation(async (_conn: unknown, command: string) => {
    if (command.includes('uname -r')) {
      mocks.steps.push('uname')
      return `__VSHU_WSL_KERNEL__ ${kernel}\n__VSHU_WSL_HOME__ /home/u\n\n__VSHU_REMOTE_PLATFORM__ Linux x86_64\n\n__VSHU_WSL_LIBC__\nldd (GNU libc) 2.39\n`
    }
    return command.includes('CONNECT_STATE_END') ? snapshotAnswer : '4242\n'
  })
  return deployAndLaunchWslVshud('Ubuntu-24.04', {
    holder: holder(),
    createTransport: transport,
    readRegistryId: async () => '0283592d-be56-40d4-b935-3dc18c3aa007',
    readIncumbent: mocks.incumbent,
    ...options
  })
}

describe('deployAndLaunchWslVshud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.steps.length = 0
    mocks.resolveContext.mockImplementation(async (target: WslVshudHostTarget, connection) => {
      mocks.steps.push('context')
      return {
        activationRecord: emptyVshudActivationRecord(),
        serverTarget: 'linux-x64-glibc',
        connection,
        host,
        remoteHome: '/home/u',
        target,
        userDataDir: '/home/u/.vshu'
      }
    })
    mocks.recover.mockResolvedValue({ outcome: 'none' })
    mocks.adopt.mockImplementation(async () => {
      mocks.steps.push('adopt-check')
      return { outcome: 'none' }
    })
    mocks.deploy.mockImplementation(async () => {
      mocks.steps.push('deploy+launch')
      return { outcome: 'installed-and-activated', fullVersion: '1.5.0+ab', verdict: {} }
    })
    mocks.probe.mockResolvedValue(READINESS)
    mocks.localVersion.mockReturnValue('1.5.0+ab')
    mocks.incumbent.mockResolvedValue({
      census: {
        liveSessions: null,
        startedSinceActivation: null,
        daemonProtocolVersion: null
      },
      readiness: null
    })
  })

  it('does not wake again when a no-boot connect finds the distro stopped meanwhile', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    mocks.probe.mockRejectedValueOnce(new VshudActiveReadinessError('exited', 'process has exited'))
    const requireRunning = vi.fn(async () => false)
    await expect(launch(undefined, { requireRunning })).rejects.toBeInstanceOf(
      WslDistroNotRunningError
    )
    expect(requireRunning).toHaveBeenCalledOnce()
    expect(mocks.wake).toHaveBeenCalledTimes(1)
  })

  // Real host (win-lowspec, cold systemd distro): the vshud the wake saw serving exited before the probe.
  it('starts the slot again when the vshud the wake saw serving exits before the probe', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'started', readiness: READINESS })
    mocks.probe.mockRejectedValueOnce(new VshudActiveReadinessError('exited', 'process has exited'))
    await expect(launch()).resolves.toMatchObject({ outcome: 'ready', port: 6790 })
    expect(mocks.wake).toHaveBeenCalledTimes(2)

    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    const refused = new VshudActiveReadinessError('rejected', 'wrong build')
    mocks.probe.mockRejectedValueOnce(refused)
    await expect(launch()).rejects.toBe(refused)
    expect(mocks.wake).toHaveBeenCalledTimes(3)
  })
})
