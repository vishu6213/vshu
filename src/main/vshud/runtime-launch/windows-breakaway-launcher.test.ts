import { describe, expect, it } from 'vitest'

import {
  VSHUD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_EXIT_CODES as RELAY_WINDOWS_BREAKAWAY_EXIT_CODES,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG as RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  type WindowsBreakawayLaunchContract
} from '../../../shared/remote-runtime/vshud-lifecycle/windows-breakaway-launch'
import {
  launchOutsideJob,
  parseWindowsBreakawayLaunchRequest,
  type SpawnOutsideJob,
  type WindowsBreakawayLauncher
} from './windows-breakaway-launcher'

// The launcher is contract-agnostic; this stands in for the retired relay's contract.
const RELAY_WINDOWS_BREAKAWAY_CONTRACT: WindowsBreakawayLaunchContract = {
  argsFlag: '--relay-args',
  reportMarker: 'VSHU_RELAY_LAUNCH'
}

const parseRelayWindowsBreakawayLaunch = (args: readonly string[]) =>
  parseWindowsBreakawayLaunchRequest(RELAY_WINDOWS_BREAKAWAY_CONTRACT, args)

function launcherFor(
  spawn: SpawnOutsideJob,
  creationTimeMs: number | null = null
): WindowsBreakawayLauncher {
  return { spawnOutsideJob: spawn, readCreationTimeMs: () => creationTimeMs }
}

const argv = [
  'C:\\rt\\node.exe',
  'C:\\Users\\me user\\.vshu-remote\\relay-1\\relay.js',
  RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  '--stdout-file',
  'C:/Users/me user/relay.log',
  '--stderr-file',
  'C:/Users/me user/relay.err.log',
  '--relay-args',
  '--detached',
  '--sock-path',
  '\\\\.\\pipe\\vshu-relay-1',
  '--log-file',
  'C:/Users/me user/relay.log'
]

describe('relay Windows breakaway launcher', () => {
  it('takes its own flags before -- and hands the rest to the relay', () => {
    expect(parseRelayWindowsBreakawayLaunch(argv)).toEqual({
      stdoutPath: 'C:/Users/me user/relay.log',
      stderrPath: 'C:/Users/me user/relay.err.log',
      env: {},
      programArgs: argv.slice(8)
    })
  })
})

describe('vshud Windows breakaway launcher', () => {
  const vshudArgv = [
    'C:\\rt\\node.exe',
    'C:\\Users\\me\\.vshu-remote\\vshud-1\\vshud.js',
    RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    '--stdout-file',
    'C:/slot/.vshud-readiness',
    '--stderr-file',
    'C:/slot/vshud.log',
    '--process-file',
    'C:/slot/.vshud-process.json',
    '--vshud-args',
    '--json',
    '--bind',
    '127.0.0.1'
  ]
  const vshudRuntime = { execPath: vshudArgv[0], script: vshudArgv[1], cwd: 'C:/slot' }

  it('splits on its own args flag, not the relay one', () => {
    expect(parseWindowsBreakawayLaunchRequest(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, vshudArgv)).toEqual(
      {
        stdoutPath: 'C:/slot/.vshud-readiness',
        stderrPath: 'C:/slot/vshud.log',
        processFilePath: 'C:/slot/.vshud-process.json',
        env: {},
        programArgs: ['--json', '--bind', '127.0.0.1']
      }
    )
  })

  it('collects --env assignments for the launched process and refuses a malformed one', () => {
    const withEnv = [
      ...vshudArgv.slice(0, 3),
      '--env',
      'VSHU_VERSION=0.2.0+bb01',
      '--env',
      'VSHU_USER_DATA=C:/Users/Ann Lee/.vshu',
      ...vshudArgv.slice(3)
    ]
    expect(
      parseWindowsBreakawayLaunchRequest(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, withEnv)?.env
    ).toEqual({ VSHU_VERSION: '0.2.0+bb01', VSHU_USER_DATA: 'C:/Users/Ann Lee/.vshu' })
    expect(() =>
      parseWindowsBreakawayLaunchRequest(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, [
        ...vshudArgv.slice(0, 3),
        '--env',
        'lower=1',
        ...vshudArgv.slice(3)
      ])
    ).toThrow('NAME=VALUE')
  })

  it('fails the launch and stops the process when its record cannot be written', () => {
    const request = parseWindowsBreakawayLaunchRequest(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, vshudArgv)
    if (!request) {
      throw new Error('expected a launch request')
    }
    const terminated: number[] = []
    const outcome = launchOutsideJob(
      request,
      launcherFor(() => ({ ok: true, pid: 4242, inJob: false })),
      vshudRuntime,
      () => {
        throw Object.assign(new Error('EACCES'), { errno: -4048 })
      },
      (pid) => terminated.push(pid)
    )
    expect(outcome).toEqual({
      report: { method: 'failed', reason: 'process-file', code: -4048 },
      exitCode: RELAY_WINDOWS_BREAKAWAY_EXIT_CODES.failed
    })
    expect(terminated).toEqual([4242])
  })

  it('reports under its own marker, which the relay parser does not read', () => {
    const line = 'VSHU_VSHUD_LAUNCH {"method":"breakaway","pid":9,"inJob":false}'
    expect(parseWindowsBreakawayLaunchReport(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, line)).toEqual({
      method: 'breakaway',
      pid: 9,
      inJob: false
    })
    expect(parseWindowsBreakawayLaunchReport(RELAY_WINDOWS_BREAKAWAY_CONTRACT, line)).toBeNull()
  })
})
