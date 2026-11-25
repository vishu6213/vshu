import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from '../../golden-journeys/golden-stub-agent'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../../desktop/renderer-probes/store'
import { waitForActivePanePtyId } from '../../terminal/input/terminal'
import { waitForTerminalOutput } from '../../terminal/layout/terminal-pane-operations'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('account switch actions return keyboard input to the terminal', async ({
  vshuPage
}, testInfo) => {
  await waitForSessionReady(vshuPage)
  await waitForActiveWorktree(vshuPage)
  await ensureTerminalVisible(vshuPage)
  await configureGoldenStubAgent(vshuPage)
  await launchGoldenStubAgentFromNewTab(vshuPage)

  for (const action of ['outside', 'keep', 'escape', 'restart'] as const) {
    const ptyId = await waitForActivePanePtyId(vshuPage)
    await vshuPage.evaluate(
      ({ ptyId, action }) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is unavailable')
        }
        store.getState().markCodexRestartNotices([
          {
            ptyId,
            previousAccountLabel: 'Previous account',
            nextAccountLabel: `Current account (${action})`
          }
        ])
      },
      { ptyId, action }
    )
    const dialog = vshuPage.getByRole('dialog').filter({ hasText: 'Account switched' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    if (action === 'outside') {
      const cardText = await dialog.getByText(/Restart this session to use/).boundingBox()
      const backdrop = await dialog.boundingBox()
      if (!cardText || !backdrop) {
        throw new Error('Account prompt has no rendered bounds')
      }
      // Why centered: the sidebar seam's resize and scrollbar strips overlap the pane's left edge.
      const outside = { x: backdrop.width / 2, y: 8 }
      await vshuPage.mouse.move(cardText.x + 8, cardText.y + 8)
      await vshuPage.mouse.down()
      await vshuPage.mouse.move(backdrop.x + outside.x, backdrop.y + outside.y)
      await vshuPage.mouse.up()
      await expect(dialog).toBeVisible()
      await vshuPage.screenshot({ path: testInfo.outputPath('account-switched.png') })
      await dialog.click({ position: outside })
    } else if (action === 'escape') {
      await vshuPage.keyboard.press('Escape')
    } else {
      await dialog
        .getByRole('button', {
          name: action === 'keep' ? 'Keep old account' : 'Restart',
          exact: true
        })
        .click()
    }
    await expect(dialog).toHaveCount(0)
    const input = vshuPage.locator('.xterm-helper-textarea:focus')
    await expect(input).toHaveCount(1)
    if (action === 'restart') {
      // This check covers the focus handoff; process replacement is a separate contract.
      break
    }
    // A printed reply proves input reached the process without an extra terminal click.
    const marker = `ACCOUNT_SWITCH_${action.toUpperCase()}`
    await vshuPage.keyboard.type(marker)
    await vshuPage.keyboard.press('Enter')
    await waitForTerminalOutput(vshuPage, `[GOLDEN_STUB_AGENT_SUBMITTED] ${marker}`, 20_000)
    await expect(input).toHaveCount(1)
    await vshuPage.screenshot({ path: testInfo.outputPath(`after-${action}.png`) })
  }
})
