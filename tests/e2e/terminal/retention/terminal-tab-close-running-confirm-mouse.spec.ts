// #10142: require middle-click confirmation, actual close on confirm, and one Cmd+W dialog across last-pane→tab delegation.
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import type { Page } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveTabId,
  ensureTerminalVisible
} from '../../desktop/renderer-probes/store'
import { focusActiveTerminalInput, waitForActivePanePtyId } from '../input/terminal'
import {
  execInTerminal,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from '../layout/terminal-pane-operations'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function closeDialog(page: Page) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: /^Stop and close$/i })
  })
}

async function startBusyTerminal(page: Page): Promise<string> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  const hasPaneManager = await waitForActiveTerminalManager(page, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(!hasPaneManager, 'Electron automation never mounted the live TerminalPane manager.')
  await waitForPaneCount(page, 1, 30_000)

  const ptyId = await waitForActivePanePtyId(page)
  await execInTerminal(page, ptyId, 'echo close-confirm-ready')
  await waitForTerminalOutput(page, 'close-confirm-ready', 20_000)
  await execInTerminal(page, ptyId, 'sleep 300')
  // Wait for sleep itself: macOS login already counts as a child before the command starts.
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.api.pty.inspectProcess(id), ptyId)).foregroundProcess,
      { timeout: 20_000, message: 'sleep 300 never became the foreground process' }
    )
    .toBe('sleep')
  return (await getActiveTabId(page))!
}

test.describe.configure({ mode: 'serial' })

test('middle-clicking a busy tab prompts, and cancelling keeps the tab', async ({ vshuPage }) => {
  test.setTimeout(120_000)
  const busyTabId = await startBusyTerminal(vshuPage)
  const busyTab = vshuPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()
  const tabsBefore = await vshuPage.locator(SORTABLE_TAB).count()

  await busyTab.click({ button: 'middle' })

  await expect(closeDialog(vshuPage)).toBeVisible({ timeout: 15_000 })
  await vshuPage.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(closeDialog(vshuPage)).toBeHidden()
  await expect(busyTab).toBeVisible()
  expect(await vshuPage.locator(SORTABLE_TAB).count()).toBe(tabsBefore)
})

test('confirming the X-button prompt closes the busy tab', async ({ vshuPage }) => {
  test.setTimeout(120_000)
  const busyTabId = await startBusyTerminal(vshuPage)
  const busyTab = vshuPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()

  await busyTab.hover()
  await busyTab.getByRole('button', { name: /^Close tab /i }).click()
  await expect(closeDialog(vshuPage)).toBeVisible({ timeout: 15_000 })
  await expect(busyTab).toBeVisible()
  await vshuPage.getByRole('button', { name: /^Stop and close$/i }).click()

  await expect(busyTab).toHaveCount(0, { timeout: 15_000 })
  await expect(closeDialog(vshuPage)).toBeHidden()
})

test('Cmd+W on a busy single-pane tab raises exactly one dialog', async ({ vshuPage }) => {
  test.setTimeout(120_000)
  const busyTabId = await startBusyTerminal(vshuPage)
  const busyTab = vshuPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()

  await focusActiveTerminalInput(vshuPage)
  await vshuPage.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
  await expect(closeDialog(vshuPage)).toBeVisible({ timeout: 15_000 })
  await vshuPage.getByRole('button', { name: /^Stop and close$/i }).click()

  await expect(busyTab).toHaveCount(0, { timeout: 15_000 })
  // Reject duplicate pane and delegated closeTerminalTab confirmations.
  await vshuPage.waitForTimeout(1_500)
  await expect(closeDialog(vshuPage)).toBeHidden()
})
