import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base } from '../../desktop/electron-fixtures/vshu-app'
import { ensureTerminalVisible, waitForSessionReady } from '../../desktop/renderer-probes/store'
import { waitForActivePanePtyId } from './terminal'
import { execInTerminal, waitForTerminalOutput } from '../layout/terminal-pane-operations'

const probeRoot = mkdtempSync(path.join(os.tmpdir(), 'vshu-e2e-path-expansion-'))
const probeBin = path.join(probeRoot, 'bin')
mkdirSync(probeBin)
writeFileSync(
  path.join(probeBin, 'vshu-path-expansion-probe.cmd'),
  '@echo off\r\necho VSHU_PATH_EXPANSION_OK\r\n'
)

const test = base
test.use({
  launchEnv: {
    VSHU_E2E_PATH_ROOT: probeRoot,
    PATH: `%VSHU_E2E_PATH_ROOT%\\bin${path.delimiter}${process.env.PATH ?? ''}`
  }
})

test.afterAll(() => {
  rmSync(probeRoot, { recursive: true, force: true })
})

test.skip(process.platform !== 'win32', 'Windows PATH expansion requires a native Windows shell')

test('expands variables in PATH before spawning a Windows shell', async ({ vshuPage }) => {
  await waitForSessionReady(vshuPage)
  await ensureTerminalVisible(vshuPage)
  const ptyId = await waitForActivePanePtyId(vshuPage)

  await execInTerminal(vshuPage, ptyId, 'vshu-path-expansion-probe')

  await waitForTerminalOutput(vshuPage, 'VSHU_PATH_EXPANSION_OK')
})
