import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installServeService, uninstallServeService, type ServeServiceDeps } from './serve-service'
import { resolveServiceCommand } from '../runtime/app-launch/serve-app-launcher'
import { serveSupervisorBrakePath } from '../runtime/serve/supervision/serve-supervisor-brake'

describe('vshu serve service', () => {
  let home: string
  let bin: string
  let calls: string[]

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'vshu-serve-service-'))
    bin = join(home, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'vshu'), '#!/bin/sh\n')
    await chmod(join(bin, 'vshu'), 0o755)
    await writeFile(join(bin, 'vshu-ide'), '#!/bin/sh\n')
    await chmod(join(bin, 'vshu-ide'), 0o755)
    calls = []
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const deps = (platform: NodeJS.Platform): ServeServiceDeps => ({
    platform,
    env: {
      PATH: `/nonexistent:${bin}`,
      VSHU_USER_DATA_PATH: join(home, 'profile'),
      ELECTRON_RUN_AS_NODE: '1'
    },
    homeDir: home,
    uid: 501,
    run: async (program, args) => {
      const line = [program, ...args].join(' ')
      calls.push(line)
      return { code: 0, out: '' }
    }
  })

  it('installs and loads a LaunchAgent, clearing an old give-up', async () => {
    await mkdir(join(home, 'profile'))
    await writeFile(serveSupervisorBrakePath(join(home, 'profile')), '{}')
    const result = await installServeService({ command: null, dryRun: false }, deps('darwin'))
    const unitPath = String(result.unitPath)
    expect(await readFile(unitPath, 'utf8')).toContain(`<string>${join(bin, 'vshu')}</string>`)
    expect(calls).toEqual([
      expect.stringMatching(/^launchctl bootout gui\/501\/com\.stablyai\.vshu\.serve\./),
      `launchctl bootstrap gui/501 ${unitPath}`
    ])
    expect(existsSync(serveSupervisorBrakePath(join(home, 'profile')))).toBe(false)
  })

  it('uninstalls by stopping the service and removing the unit', async () => {
    const d = deps('linux')
    const result = await installServeService({ command: null, dryRun: false }, d)
    calls = []
    await expect(uninstallServeService(d)).resolves.toMatchObject({ removed: true })
    expect(existsSync(String(result.unitPath))).toBe(false)
    expect(calls).toEqual([
      `systemctl --user disable --now ${String(result.name)}`,
      'systemctl --user daemon-reload'
    ])
  })

  it('skips a profile launcher and refuses a bare Linux vshu', async () => {
    const scoped = join(home, 'profile', 'cli', 'bin')
    await mkdir(scoped, { recursive: true })
    await writeFile(join(scoped, 'vshu'), '#!/bin/sh\n')
    await chmod(join(scoped, 'vshu'), 0o755)
    expect(
      resolveServiceCommand(null, {
        platform: 'darwin',
        env: { PATH: `${scoped}:${bin}`, VSHU_USER_DATA_PATH: join(home, 'profile') }
      })
    ).toBe(join(bin, 'vshu'))
    // Linux takes only vshu-ide, never a bare `vshu` (often the screen reader).
    const onlyVshu = join(home, 'only-vshu')
    await mkdir(onlyVshu)
    await writeFile(join(onlyVshu, 'vshu'), '#!/bin/sh\n')
    await chmod(join(onlyVshu, 'vshu'), 0o755)
    expect(() =>
      resolveServiceCommand(null, {
        platform: 'linux',
        env: { PATH: onlyVshu, VSHU_USER_DATA_PATH: join(home, 'profile') }
      })
    ).toThrow(/PATH/)
  })
})
