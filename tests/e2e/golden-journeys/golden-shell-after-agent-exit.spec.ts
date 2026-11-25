import { test } from '../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './golden-stub-agent'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../desktop/renderer-probes/store'
import { waitForRestoredTerminalInputReady } from '../terminal/readiness/restored-terminal-input-readiness'
import { focusActiveTerminalInput, waitForActivePanePtyId } from '../terminal/input/terminal'
import { waitForTerminalOutput } from '../terminal/layout/terminal-pane-operations'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Split the marker so terminal input echo cannot impersonate successful shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ vshuPage }) => {
  await waitForSessionReady(vshuPage)
  await waitForActiveWorktree(vshuPage)
  await ensureTerminalVisible(vshuPage)
  await configureGoldenStubAgent(vshuPage)
  await launchGoldenStubAgentFromNewTab(vshuPage)

  await vshuPage.keyboard.type('exit')
  await vshuPage.keyboard.press('Enter')
  await waitForTerminalOutput(vshuPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await vshuPage.locator('[data-testid="sortable-tab"]').count()
  await vshuPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await vshuPage
    .getByRole('menu')
    .getByRole('button', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(vshuPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(vshuPage)
  // A bound pane can precede transport readiness; wait or marker keystrokes may be dropped.
  expect(await waitForRestoredTerminalInputReady(vshuPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(vshuPage)
  await vshuPage.keyboard.type(afterAgent.command)
  await vshuPage.keyboard.press('Enter')
  await waitForTerminalOutput(vshuPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await vshuPage.keyboard.press('Shift+Enter')
  await vshuPage.keyboard.type(afterShiftEnter.command)
  await vshuPage.keyboard.press('Enter')
  await waitForTerminalOutput(vshuPage, afterShiftEnter.marker, 15_000)
  await expect(vshuPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
