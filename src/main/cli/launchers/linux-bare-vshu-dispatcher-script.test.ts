import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => tmpdir(), getAppPath: () => tmpdir() }
}))
import { installLinuxBareVshuDispatcher } from './linux-bare-vshu-dispatcher'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeProgram(path: string, output: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `#!/bin/sh\necho "${output} $*"\n`, 'utf8')
  await chmod(path, 0o755)
}

/** A home with Vshu's dispatcher installed, and a second `vshu` (as GNOME's screen reader). */
async function makeFixture(): Promise<{
  root: string
  homePath: string
  resourcesPath: string
  launcherPath: string
  dispatcherPath: string
  screenReaderDir: string
  toolsDir: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'vshu bare dispatcher '))
  created.push(root)
  const homePath = join(root, 'home')
  const resourcesPath = join(root, 'resources')
  const launcherPath = join(resourcesPath, 'bin', 'vshu-ide')
  const screenReaderDir = join(root, 'usr-bin')
  await writeProgram(launcherPath, 'VSHU_CLI')
  await writeProgram(join(screenReaderDir, 'vshu'), 'SCREEN_READER')
  // Only bash on the base PATH, so a runner's own /usr/bin/vshu cannot answer.
  const toolsDir = join(root, 'tools')
  await mkdir(toolsDir)
  const bash = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim()
  await symlink(bash, join(toolsDir, 'bash'))
  const result = await installLinuxBareVshuDispatcher({
    resourcesPath,
    homePath,
    appImagePath: null
  })
  expect(result.state).toBe('installed')
  return {
    root,
    homePath,
    resourcesPath,
    launcherPath,
    dispatcherPath: result.dispatcherPath,
    screenReaderDir,
    toolsDir
  }
}

function runVshu(
  fixture: { homePath: string; toolsDir: string },
  pathDirs: string[],
  env: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('vshu', ['status'], {
    encoding: 'utf8',
    env: { HOME: fixture.homePath, PATH: [...pathDirs, fixture.toolsDir].join(':'), ...env },
    timeout: 10_000
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe.runIf(process.platform !== 'win32')('the bare vshu dispatcher as a shell runs it', () => {
  it("leaves another `vshu` on PATH (GNOME's screen reader) to everyone but Vshu's children", async () => {
    const fixture = await makeFixture()
    const binDir = join(fixture.homePath, '.local', 'bin')

    expect(runVshu(fixture, [binDir, fixture.screenReaderDir]).stdout).toBe(
      'SCREEN_READER status\n'
    )
    expect(
      runVshu(fixture, [binDir, fixture.screenReaderDir], { VSHU_PANE_KEY: 'tab:1' }).stdout
    ).toBe('VSHU_CLI status\n')
    expect(
      runVshu(fixture, [binDir, fixture.screenReaderDir], { VSHU_CLI_BIN_DIR: '/x' }).stdout
    ).toBe('VSHU_CLI status\n')
  })
})
