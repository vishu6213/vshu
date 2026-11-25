import { readFile, writeFile } from 'node:fs/promises'
import { buildShellCommandFromArgv } from '../../../../src/shared/agent-launch/startup/tui-agent-startup-shell'
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../../desktop/renderer-probes/store'
import { waitForActivePanePtyId } from '../../terminal/input/terminal'
import {
  execInTerminal,
  waitForActiveTerminalManager
} from '../../terminal/layout/terminal-pane-operations'
import { waitForActivePaneHookDescriptor } from '../../terminal/input/terminal-active-pane'

test('OMP model picker dispatches its advertised command and adopts the host report', async ({
  vshuPage,
  electronApp
}, testInfo) => {
  test.skip(process.platform === 'win32', 'POSIX PTY capture fixture')
  await waitForSessionReady(vshuPage)
  await waitForActiveWorktree(vshuPage)
  await ensureTerminalVisible(vshuPage)
  await waitForActiveTerminalManager(vshuPage)
  const descriptor = await waitForActivePaneHookDescriptor(vshuPage)
  const ptyId = await waitForActivePanePtyId(vshuPage)
  const output = testInfo.outputPath('model-command.txt')
  const script = testInfo.outputPath('capture.cjs')
  await writeFile(
    script,
    `const fs = require('node:fs'); let data = ''; process.stdin.setRawMode(true); process.stdin.on('data', chunk => { data += chunk; fs.writeFileSync(${JSON.stringify(output)}, data); });`
  )
  await execInTerminal(
    vshuPage,
    ptyId,
    buildShellCommandFromArgv([process.execPath, script], 'posix')
  )
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('git:discoverCommitMessageModels')
    ipcMain.handle('git:discoverCommitMessageModels', () => ({
      success: true,
      catalogOrigin: 'probe',
      models: [
        { id: 'anthropic/claude-sonnet-4-5', label: 'Sonnet 4.5' },
        { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6' }
      ]
    }))
  })
  await vshuPage.evaluate(async ({ paneKey, worktreeId }) => {
    const settings = await window.api.settings.set({ nativeChatProviders: { omp: true } })
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    store.setState({ settings })
    const state = store.getState()
    state.setAgentStatus(
      paneKey,
      {
        state: 'done',
        prompt: '',
        agentType: 'omp',
        model: 'anthropic/claude-sonnet-4-5',
        modelSwitchCommand: 'vshu-model'
      },
      'OMP',
      undefined,
      { worktreeId }
    )
    const [tabId] = paneKey.split(':')
    const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
    )
    if (!tab) {
      throw new Error('Terminal tab unavailable')
    }
    state.toggleTabViewMode(tab.id)
  }, descriptor)
  const picker = vshuPage.getByRole('button', { name: 'Model Sonnet 4.5', exact: true })
  await expect(picker).toBeVisible()
  await picker.click()
  await expect(vshuPage.getByRole('option', { name: 'Sonnet 4.6', exact: true })).toBeVisible()
  await vshuPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('omp-model-choices.png')
  })
  await vshuPage.getByRole('option', { name: 'Sonnet 4.6', exact: true }).click()
  await expect
    .poll(async () => readFile(output, 'utf8').catch(() => ''))
    .toContain('/vshu-model anthropic/claude-sonnet-4-6')
  await vshuPage.evaluate(({ paneKey, worktreeId }) => {
    window.__store?.getState().setAgentStatus(
      paneKey,
      {
        state: 'done',
        prompt: '',
        agentType: 'omp',
        model: 'anthropic/claude-sonnet-4-6',
        modelSwitchCommand: 'vshu-model'
      },
      'OMP',
      undefined,
      { worktreeId }
    )
  }, descriptor)
  await expect(
    vshuPage.getByRole('button', { name: 'Model Sonnet 4.6', exact: true })
  ).toBeVisible()
  await vshuPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('omp-model-reported.png')
  })
})
