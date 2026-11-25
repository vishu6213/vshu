import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '@vshu/process-host'
import {
  VSHUD_LAUNCHER_FILENAME,
  VSHUD_SERVER_ENTRY_FILENAME
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'

let directory = ''
let launcher = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vshud-help-'))
  launcher = join(directory, VSHUD_LAUNCHER_FILENAME)
  const builder = pathToFileURL(
    join(process.cwd(), 'config/scripts/vshud-distribution/server-bundle/vshud-entry-build.mjs')
  ).href
  const built = await runProcess({
    program: process.execPath,
    args: [
      '--input-type=module',
      '-e',
      `import {buildVshudEntry,buildVshudLauncher} from ${JSON.stringify(builder)};` +
        `await buildVshudEntry(${JSON.stringify(join(directory, VSHUD_SERVER_ENTRY_FILENAME))});` +
        `await buildVshudLauncher(${JSON.stringify(launcher)});`
    ],
    env: { ...process.env, VSHU_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 60_000
  })
  expect(built.code, built.stderr).toBe(0)
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('real vshud executable help', () => {
  it('leaves an existing instance lock untouched', async () => {
    const dataRoot = join(directory, 'locked-profile')
    await mkdir(dataRoot)
    const lock = join(dataRoot, 'vshud.lock')
    const content = 'an existing instance owns this profile\n'
    await writeFile(lock, content)
    const result = await runProcess({
      program: process.execPath,
      args: [launcher, '--help'],
      env: { ...process.env, VSHU_BACKGROUND_LAUNCH: '1', VSHU_USER_DATA: dataRoot },
      timeoutMs: 10_000
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(await readFile(lock, 'utf8')).toBe(content)
    expect(await readdir(dataRoot)).toEqual(['vshud.lock'])
  })
})
