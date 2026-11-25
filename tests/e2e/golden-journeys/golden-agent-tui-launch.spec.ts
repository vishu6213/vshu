import { test } from '../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './golden-stub-agent'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../desktop/renderer-probes/store'
import { focusActiveTerminalInput } from '../terminal/input/terminal'
import { getTerminalContent } from '../terminal/layout/terminal-pane-identity'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('launches an agent TUI with a live multiline composer', async ({ vshuPage }) => {
  await waitForSessionReady(vshuPage)
  await waitForActiveWorktree(vshuPage)
  await ensureTerminalVisible(vshuPage)
  await configureGoldenStubAgent(vshuPage)
  await launchGoldenStubAgentFromNewTab(vshuPage)

  const activeTab = vshuPage.locator('[data-testid="sortable-tab"][data-active="true"]')
  await expect(activeTab).toHaveAttribute('data-tab-title', /Codex|Golden Stub Agent/i)

  await focusActiveTerminalInput(vshuPage)
  await vshuPage.keyboard.type('hello from e2e')
  await vshuPage.keyboard.press('Shift+Enter')
  await vshuPage.keyboard.type('second line')

  await expect
    .poll(() => getTerminalContent(vshuPage), { timeout: 10_000 })
    .toContain('> hello from e2e\r\n  second line')
  expect(await getTerminalContent(vshuPage)).not.toContain('GOLDEN_STUB_AGENT_SUBMITTED')
})
