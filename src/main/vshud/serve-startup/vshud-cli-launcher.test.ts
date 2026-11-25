import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@vshu/process-host'
import { VSHUD_CLI_ENTRY_FILENAME } from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { getVshudCliLauncherPath, prepareVshudCliLauncher } from './vshud-cli-launcher'

const roots = vi.hoisted(() => ({ install: '', profile: '' }))
vi.mock('../host-runtime/vshud-app-paths', () => ({
  resolveVshudInstallRoot: () => roots.install,
  resolveUserDataPath: () => roots.profile
}))

let directory = ''
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vshu-node-cli-'))
  roots.install = join(directory, "server ' slot")
  roots.profile = join(directory, "profile ' data")
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', platformDescriptor)
  await rm(directory, { recursive: true, force: true })
})

async function writeCli(): Promise<void> {
  const path = join(roots.install, ...VSHUD_CLI_ENTRY_FILENAME.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    'console.log(JSON.stringify({profile:process.env.VSHU_USER_DATA_PATH, args:process.argv.slice(2), electron:process.env.ELECTRON_RUN_AS_NODE}))'
  )
}

describe('vshud profile CLI launcher', () => {
  it.skipIf(process.platform === 'win32')(
    'launches pinned Node with intact arguments and the execution host profile',
    async () => {
      await writeCli()
      await prepareVshudCliLauncher()
      const launcher = getVshudCliLauncherPath()
      expect(launcher).toBe(join(roots.profile, 'cli', 'bin', 'vshu'))
      if (!launcher) {
        throw new Error('CLI launcher is missing')
      }
      const args = ['orchestration', 'send', 'a body\nwith "quotes" and $HOME']
      const launchers =
        process.platform === 'linux' ? [launcher, join(dirname(launcher), 'vshu-ide')] : [launcher]
      for (const program of launchers) {
        const result = await runProcess({
          program,
          args,
          env: {
            ...process.env,
            VSHU_USER_DATA_PATH: '/another/owner',
            ELECTRON_RUN_AS_NODE: '1',
            NODE_OPTIONS: '--require /missing/inherited/preload'
          },
          timeoutMs: 5000
        })
        expect(result.code).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({ profile: roots.profile, args })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    "passes a person's own Vshu settings through, adding only the profile",
    async () => {
      const path = join(roots.install, ...VSHUD_CLI_ENTRY_FILENAME.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(
        path,
        "console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VSHU_')))))"
      )
      await prepareVshudCliLauncher()
      const result = await runProcess({
        program: getVshudCliLauncherPath()!,
        args: ['status'],
        env: {
          PATH: process.env.PATH,
          VSHU_ENVIRONMENT: 'other-server',
          VSHU_PAIRING_CODE: 'other-pairing'
        },
        timeoutMs: 5000
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        VSHU_USER_DATA_PATH: roots.profile,
        VSHU_ENVIRONMENT: 'other-server',
        VSHU_PAIRING_CODE: 'other-pairing'
      })
    }
  )
})
